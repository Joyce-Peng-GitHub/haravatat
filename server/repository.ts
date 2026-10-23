import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ipaddr from 'ipaddr.js';
import { z } from 'zod';
import { HttpError } from './errors.js';
import {
  MAX_SOURCE_BYTES,
  MAX_FILES,
  validateFiles,
  virtualPath,
  type SourceFile,
} from './files.js';
export interface RepositorySnapshot {
  files: SourceFile[];
  commit: string;
}
export interface RepositoryClient {
  snapshot(
    repository: string,
    branch: string,
    token?: string,
    username?: string,
    commit?: string,
  ): Promise<RepositorySnapshot>;
}
export function repositoryUrl(value: string) {
  let input = value.trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) input = `https://github.com/${input}`;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, '请填写 HTTPS Git 仓库地址');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\\\x00-\x20\x7f]/.test(input) ||
    /%(?:00|0a|0d|2f|5c)/i.test(input) ||
    url.pathname === '/' ||
    url.pathname.split('/').some((p) => p === '.' || p === '..')
  )
    throw new HttpError(400, '仓库必须使用 HTTPS，且不能包含凭据、查询参数或片段');
  return url.href.replace(/\/$/, '');
}
export function repositoryBranch(branch: string) {
  if (
    !branch ||
    branch.length > 200 ||
    branch.startsWith('-') ||
    branch.endsWith('.') ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) ||
    branch.includes('..') ||
    branch.includes('@{') ||
    branch.split('/').some((p) => !p || p.startsWith('.') || p.endsWith('.lock'))
  )
    throw new HttpError(400, '分支名无效，请填写精确的分支名');
  return branch;
}
export function repositoryCommit(value: string) {
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value))
    throw new HttpError(400, '请填写完整 Commit SHA（40 或 64 位十六进制）');
  return value.toLowerCase();
}
type ResolveHost = (
  host: string,
  options: { all: true; verbatim: true },
) => Promise<{ address: string; family: number }[]>;
export function httpsDnsLookup(endpoint: string): ResolveHost {
  const resolver = new URL(endpoint);
  if (resolver.protocol !== 'https:' || resolver.username || resolver.password || resolver.hash)
    throw new Error('GIT_DNS_OVER_HTTPS_URL requires an HTTPS resolver URL without credentials');
  return async (host) => {
    const answers = await Promise.all(
      ([1, 28] as const).map(async (type) => {
        const url = new URL(resolver);
        url.searchParams.set('name', host);
        url.searchParams.set('type', String(type));
        const response = await fetch(url, {
          headers: { accept: 'application/dns-json' },
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new HttpError(502, 'HTTPS DNS 解析失败');
        const result = z
          .object({
            Status: z.literal(0),
            Answer: z.array(z.object({ type: z.number(), data: z.string() })).default([]),
          })
          .parse(JSON.parse((await boundedBody(response, 65_536)).toString()));
        return result.Answer.filter((answer) => answer.type === type).map((answer) => ({
          address: answer.data,
          family: type === 1 ? 4 : 6,
        }));
      }),
    );
    return answers.flat();
  };
}
export async function repositoryTarget(repository: string, resolve: ResolveHost = lookup) {
  const url = new URL(repositoryUrl(repository));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(host)
    ? [{ address: host }]
    : await Promise.race([
        resolve(host, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new HttpError(502, '仓库域名解析超时')), 10_000);
          timer.unref();
        }),
      ]).catch(() => {
        throw new HttpError(502, '无法解析仓库域名');
      });
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) => !ipaddr.isValid(address) || ipaddr.process(address).range() !== 'unicast',
    )
  )
    throw new HttpError(400, '仓库地址必须指向公网，不能访问本机、内网或保留地址');
  const address = addresses[0].address;
  return { url: url.href.replace(/\/$/, ''), address };
}
// Route every HTTPS connection through a narrowly scoped tunnel, including Git alternates.
// TLS stays end to end; DNS is never resolved again after the public address check.
export async function repositoryProxy(target: { url: string; address: string }) {
  const url = new URL(target.url);
  const authority = `${url.hostname}:${url.port || '443'}`;
  const sockets = new Set<Socket>();
  const server = createServer(
    { maxHeaderSize: 8192, headersTimeout: 10_000 },
    (_request, response) => response.writeHead(403).end(),
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(60_000, () => socket.destroy());
  });
  server.on('connect', (request, socket, head) => {
    if (request.url !== authority || sockets.size > 8) {
      socket.destroy();
      return;
    }
    const upstream = connect({ host: target.address, port: Number(url.port || 443) });
    sockets.add(upstream);
    upstream.on('close', () => {
      sockets.delete(upstream);
      socket.destroy();
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.setTimeout(60_000, () => upstream.destroy());
    upstream.on('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
interface GitOptions {
  env?: NodeJS.ProcessEnv;
  input?: Buffer;
  max?: number;
}
async function git(
  directory: string,
  args: string[],
  { env = {}, input, max = MAX_SOURCE_BYTES + 1024 * 1024 }: GitOptions = {},
) {
  return new Promise<Buffer>((resolve, reject) => {
    const limited = process.platform === 'linux';
    const child = spawn(
      limited ? 'prlimit' : 'git',
      limited
        ? [
            '--as=4294967296',
            '--cpu=120',
            '--fsize=2147483648',
            '--nofile=128',
            '--',
            'git',
            ...args,
          ]
        : args,
      {
        cwd: directory,
        detached: limited,
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          LANG: 'C.UTF-8',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ALLOW_PROTOCOL: 'https',
          ...env,
        },
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    let size = 0,
      failure: HttpError | undefined;
    const chunks: Buffer[] = [];
    const stop = (error: HttpError) => {
      failure ??= error;
      if (child.pid) {
        try {
          process.kill(limited ? -child.pid : child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      }
    };
    const timer = setTimeout(
      () => stop(new HttpError(502, 'Git 操作超时，请检查网络或仓库大小后重试')),
      300_000,
    );
    child.on('error', () => {
      clearTimeout(timer);
      reject(new HttpError(502, '无法启动 Git，请检查服务器 Git 和 prlimit 安装'));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) stop(new HttpError(413, '仓库超过工作区限制'));
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new HttpError(
            502,
            'Git 同步失败，请检查仓库 HTTPS 克隆地址、分支、用户名及 token 权限；服务器不跟随重定向',
          ),
        );
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.on('error', () => {
      /* A failed Git process may close stdin before reading. */
    });
    child.stdin.end(input);
  });
}
export async function gitSnapshotFiles(directory: string, commit: string): Promise<SourceFile[]> {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new HttpError(502, '仓库 commit 无效');
  const tree = await git(directory, ['ls-tree', '-r', '-l', '-z', commit], {
    max: 2 * 1024 * 1024,
  });
  const entries: { path: string; object: string; size: number }[] = [];
  let total = 0;
  for (const row of tree.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^([0-7]+) (\w+) ([a-f0-9]+) +([0-9-]+)\t([\s\S]+)$/.exec(row);
    if (!match || !['100644', '100755'].includes(match[1]) || match[2] !== 'blob')
      throw new HttpError(400, '仓库不允许符号链接、子模块或特殊文件');
    const size = Number(match[4]);
    total += size;
    if (entries.length >= MAX_FILES) throw new HttpError(413, '每个工作区最多 1024 个文件');
    if (total > MAX_SOURCE_BYTES) throw new HttpError(413, '工作区总大小不能超过 1 GiB');
    entries.push({ path: virtualPath(match[5]), object: match[3], size });
  }
  if (!entries.length) return [];
  // Read objects directly: never checkout, execute filters, hooks, or submodules.
  const data = await git(directory, ['cat-file', '--batch'], {
    input: Buffer.from(entries.map((e) => e.object).join('\n') + '\n'),
  });
  let offset = 0;
  const files = entries.map((entry) => {
    const end = data.indexOf(10, offset);
    if (
      end < offset ||
      data.subarray(offset, end).toString() !== `${entry.object} blob ${entry.size}` ||
      end + entry.size + 1 >= data.length ||
      data[end + entry.size + 1] !== 10
    )
      throw new HttpError(502, '仓库对象读取失败');
    offset = end + entry.size + 2;
    return { path: entry.path, content: data.subarray(end + 1, offset - 1) };
  });
  validateFiles(files);
  return files;
}
let syncing = false;
export function createGitRepositories(resolve?: ResolveHost): RepositoryClient {
  return {
    async snapshot(repository, branch, token, username, commit) {
      if (syncing) throw new HttpError(503, '仓库同步繁忙，请稍后重试');
      const reference = commit
        ? repositoryCommit(commit)
        : `refs/heads/${repositoryBranch(branch)}`;
      if (
        (token && /[\x00-\x1f\x7f]/.test(token)) ||
        (username && /[:\x00-\x1f\x7f]/.test(username))
      )
        throw new HttpError(400, '仓库认证信息无效');
      syncing = true;
      let directory: string | undefined;
      let proxy: Awaited<ReturnType<typeof repositoryProxy>> | undefined;
      try {
        const target = await repositoryTarget(repository, resolve);
        proxy = await repositoryProxy(target);
        directory = await mkdtemp(join(tmpdir(), 'haravatat-git-'));
        await git(directory, [
          'init',
          '--bare',
          '--template=',
          ...(commit?.length === 64 ? ['--object-format=sha256'] : []),
        ]);
        const settings: [string, string][] = [
          ['http.followRedirects', 'false'],
          ['http.proxy', proxy.url],
          ['http.sslVerify', 'true'],
          ['credential.helper', ''],
          ['core.hooksPath', '/dev/null'],
          ['fetch.fsckObjects', 'true'],
          ['http.lowSpeedLimit', '1024'],
          ['http.lowSpeedTime', '15'],
        ];
        if (token) {
          const login =
            username ||
            (new URL(target.url).hostname === 'gitlab.com' ? 'oauth2' : 'x-access-token');
          settings.push([
            `http.${target.url}.extraHeader`,
            `Authorization: Basic ${Buffer.from(`${login}:${token}`).toString('base64')}`,
          ]);
        }
        const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(settings.length) };
        settings.forEach(([key, value], i) => {
          env[`GIT_CONFIG_KEY_${i}`] = key;
          env[`GIT_CONFIG_VALUE_${i}`] = value;
        });
        await git(
          directory,
          [
            'fetch',
            '--depth=1',
            '--no-tags',
            '--no-recurse-submodules',
            '--',
            target.url,
            reference,
          ],
          { env, max: 1024 * 1024 },
        );
        const resolvedCommit = (
          await git(directory, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
        )
          .toString()
          .trim();
        if (commit && resolvedCommit !== reference)
          throw new HttpError(502, '远端返回的 Commit 与指定 SHA 不匹配');
        return { commit: resolvedCommit, files: await gitSnapshotFiles(directory, resolvedCommit) };
      } finally {
        try {
          try {
            if (proxy) await proxy.close();
          } finally {
            if (directory) await rm(directory, { recursive: true, force: true });
          }
        } finally {
          syncing = false;
        }
      }
    },
  };
}
export const gitRepositories = createGitRepositories();
export async function boundedBody(response: Response, max: number) {
  if (!response.body) throw new HttpError(502, '下载内容为空');
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new HttpError(413, '下载内容超过大小限制');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
