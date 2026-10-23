import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { loadConfig } from '../server/config.js';
import {
  repositoryUrl,
  repositoryBranch,
  repositoryCommit,
  repositoryTarget,
  repositoryProxy,
  httpsDnsLookup,
  gitSnapshotFiles,
} from '../server/repository.js';

test('HTTPS clone URLs support arbitrary hosts, nested paths and ports with GitHub shorthand compatibility', () => {
  assert.equal(repositoryUrl('alice/notes'), 'https://github.com/alice/notes');
  for (const url of [
    'https://gitlab.com/group/subgroup/notes.git',
    'https://codeberg.org/alice/notes.git',
    'https://git.example.com:8443/scm/notes.git',
    'https://github.com/alice/notes.git',
  ])
    assert.equal(repositoryUrl(url), url);
  for (const url of [
    'http://example.com/repo',
    'ssh://git@example.com/repo',
    'git@example.com:repo',
    'file:///tmp/repo',
    'https://user:secret@example.com/repo',
    'https://example.com/repo?token=secret',
    'https://example.com/repo#main',
    'https://example.com/\\repo',
    'https://example.com/',
  ])
    assert.throws(() => repositoryUrl(url));
  assert.equal(repositoryCommit('A'.repeat(40)), 'a'.repeat(40));
  assert.equal(repositoryCommit('b'.repeat(64)), 'b'.repeat(64));
  for (const sha of ['abc123', 'main', 'x'.repeat(40), 'a'.repeat(41)])
    assert.throws(() => repositoryCommit(sha));
  assert.equal(repositoryBranch('feature/blog'), 'feature/blog');
  for (const branch of [
    '-main',
    '../main',
    'refs//main',
    'main.lock',
    'main@{1}',
    'main:tag',
    'main\n',
  ])
    assert.throws(() => repositoryBranch(branch));
});

test('repository destinations reject private, mapped and mixed DNS answers before fetching', async () => {
  for (const host of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '0x7f000001',
    '[::1]',
    '[::ffff:127.0.0.1]',
    '[fc00::1]',
    '[2002:7f00:1::]',
  ])
    await assert.rejects(repositoryTarget(`https://${host}/repo`), /公网/);
  await assert.rejects(
    repositoryTarget('https://git.example.com/repo', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]),
    /公网/,
  );
  const target = await repositoryTarget('https://git.example.com:8443/group/repo.git', async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
  assert.equal(target.address, '93.184.216.34');
  assert.equal(target.url, 'https://git.example.com:8443/group/repo.git');
});

test('native Git object snapshots preserve binary files and fixed commits, accepting large blobs and rejecting symlinks and excess file counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'git-test-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    })
      .toString()
      .trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'snapshot');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    await mkdir(join(directory, '笔记'));
    await writeFile(join(directory, '笔记', 'entry.typ'), '= Hello');
    const binary = Buffer.from([0, 1, 255, 13, 10]);
    await writeFile(join(directory, 'image.png'), binary);
    const first = commit();
    await writeFile(join(directory, '笔记', 'entry.typ'), '= Updated');
    const second = commit();
    const files = await gitSnapshotFiles(directory, first);
    assert.equal(files.find((f) => f.path === '笔记/entry.typ')?.content.toString(), '= Hello');
    assert.deepEqual(files.find((f) => f.path === 'image.png')?.content, binary);
    assert.equal(
      (await gitSnapshotFiles(directory, second))
        .find((f) => f.path === '笔记/entry.typ')
        ?.content.toString(),
      '= Updated',
    );
    await symlink('/etc/passwd', join(directory, 'link'));
    await assert.rejects(gitSnapshotFiles(directory, commit()), /符号链接/);
    await rm(join(directory, 'link'));
    await writeFile(join(directory, 'large'), Buffer.alloc(8 * 1024 * 1024 + 1));
    assert.equal(
      (await gitSnapshotFiles(directory, commit())).find((file) => file.path === 'large')?.content
        .length,
      8 * 1024 * 1024 + 1,
    );
    for (let i = 0; i < 1021; i++) await writeFile(join(directory, `file-${i}`), '');
    assert.equal((await gitSnapshotFiles(directory, commit())).length, 1024);
    await writeFile(join(directory, 'extra-file'), '');
    await assert.rejects(gitSnapshotFiles(directory, commit()), /1024/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Git CONNECT proxy pins the validated IP and refuses different hosts, ports and plain requests', async () => {
  let connections = 0;
  const upstream = createServer((socket) => {
    connections++;
    socket.on('data', (chunk) => socket.write(chunk));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const proxy = await repositoryProxy({
    url: `https://git.example.com:${address.port}/repo`,
    address: '127.0.0.1',
  });
  const port = Number(new URL(proxy.url).port);
  const request = (line: string) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(line));
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
        socket.destroy();
      });
      socket.on('error', reject);
      socket.on('close', () => resolve(data));
    });
  try {
    assert.match(
      await request(
        `CONNECT git.example.com:${address.port} HTTP/1.1\r\nHost: git.example.com\r\n\r\n`,
      ),
      /200 Connection Established/,
    );
    assert.equal(connections, 1);
    assert.equal(
      await request('CONNECT 169.254.169.254:443 HTTP/1.1\r\nHost: forbidden\r\n\r\n'),
      '',
    );
    assert.equal(
      await request(
        `CONNECT other.example.com:${address.port} HTTP/1.1\r\nHost: forbidden\r\n\r\n`,
      ),
      '',
    );
    assert.equal(
      await request('CONNECT git.example.com:1 HTTP/1.1\r\nHost: forbidden\r\n\r\n'),
      '',
    );
    assert.match(
      await request('GET http://169.254.169.254/latest HTTP/1.1\r\nHost: forbidden\r\n\r\n'),
      /403/,
    );
    assert.equal(connections, 1);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test('optional HTTPS DNS requests both families and still rejects private answers', async () => {
  assert.equal(
    loadConfig({ DATABASE_URL: 'postgres://unused', GIT_DNS_OVER_HTTPS_URL: '' })
      .GIT_DNS_OVER_HTTPS_URL,
    undefined,
  );
  assert.throws(() =>
    loadConfig({
      DATABASE_URL: 'postgres://unused',
      GIT_DNS_OVER_HTTPS_URL: 'http://resolver.example/dns-query',
    }),
  );
  const original = globalThis.fetch;
  const calls: URL[] = [];
  let privateAnswer = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json({
      Status: 0,
      Answer:
        url.searchParams.get('type') === '1'
          ? [{ type: 1, data: privateAnswer ? '127.0.0.1' : '93.184.216.34' }]
          : [],
    });
  };
  try {
    const resolve = httpsDnsLookup('https://dns.example.com/dns-query');
    const target = await repositoryTarget('https://git.example.com/private/repo.git', resolve);
    assert.equal(target.address, '93.184.216.34');
    assert.deepEqual(
      calls.map((url) => url.searchParams.get('type')),
      ['1', '28'],
    );
    assert.ok(
      calls.every(
        (url) =>
          url.searchParams.get('name') === 'git.example.com' && !url.href.includes('private'),
      ),
    );
    privateAnswer = true;
    await assert.rejects(repositoryTarget('https://git.example.com/repo', resolve), /公网/);
    assert.throws(() => httpsDnsLookup('http://dns.example.com/dns-query'));
  } finally {
    globalThis.fetch = original;
  }
});
