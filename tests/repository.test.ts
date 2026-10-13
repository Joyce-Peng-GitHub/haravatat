import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { githubRepositories, extractRepository } from '../server/repository.js';
function archive(path = 'repo/notes/hello.md', mode = 0o100644) {
  const name = Buffer.from(path),
    data = Buffer.from('# Hello');
  const local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((mode << 16) >>> 0, 38);
  const content = Buffer.concat([local, name, data]),
    directory = Buffer.concat([central, name]);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(content.length, 16);
  return Buffer.concat([content, directory, end]);
}
test('repository ZIP preserves directories and refuses traversal and symlinks', async () => {
  assert.equal((await extractRepository(archive()))[0].path, 'notes/hello.md');
  await assert.rejects(extractRepository(archive('repo/../secret')));
  await assert.rejects(extractRepository(archive('repo/link', 0o120777)), /符号链接/);
});
test('private repository PAT only authorizes GitHub API and redirect is restricted', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; authorization: string | null }[] = [];
  let redirect = 'https://codeload.github.com/alice/notes/legacy.zip/commit?token=download';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    if (url.includes('/commits/')) return Response.json({ sha: 'a'.repeat(40) });
    if (url.includes('/zipball/'))
      return new Response(null, { status: 302, headers: { location: redirect } });
    return new Response(new Uint8Array(archive()));
  };
  try {
    const snapshot = await githubRepositories.snapshot(
      'alice/notes',
      'feature/blog',
      'github_pat_test',
    );
    assert.equal(snapshot.files[0].path, 'notes/hello.md');
    assert.match(calls[0].url, /feature%2Fblog/);
    assert.equal(calls[0].authorization, 'Bearer github_pat_test');
    assert.equal(calls[1].authorization, 'Bearer github_pat_test');
    assert.equal(calls[2].authorization, null);
    calls.length = 0;
    redirect = 'https://attacker.invalid/archive';
    await assert.rejects(
      githubRepositories.snapshot('alice/notes', 'main', 'github_pat_test'),
      /允许范围/,
    );
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});
