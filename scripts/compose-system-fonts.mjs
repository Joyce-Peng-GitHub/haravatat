import { execFileSync, spawnSync } from 'node:child_process';
import { realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const production = args[0] === '--production';
if (production) args.shift();
if (args.includes('--help')) {
  console.log('node scripts/compose-system-fonts.mjs [--production] [Docker Compose arguments]');
  console.log('Default: up -d --wait. --print prepares the font mounts without running Docker.');
  process.exit(0);
}

const candidates = new Set();
if (process.platform === 'win32') {
  if (process.env.WINDIR) candidates.add(join(process.env.WINDIR, 'Fonts'));
  if (process.env.LOCALAPPDATA)
    candidates.add(join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
} else if (process.platform === 'darwin') {
  candidates.add('/System/Library/Fonts');
  candidates.add('/Library/Fonts');
  candidates.add(join(homedir(), 'Library', 'Fonts'));
} else {
  candidates.add('/usr/share/fonts');
  candidates.add('/usr/local/share/fonts');
  candidates.add(join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'fonts'));
  candidates.add(join(homedir(), '.fonts'));
  // WSL: this directory is outside Linux's font tree, whose Windows link would
  // otherwise be broken inside the container.
  candidates.add('/mnt/c/Windows/Fonts');
}

try {
  const files = execFileSync('fc-list', ['--format', '%{file}\n'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  for (const file of files.split('\n').filter(Boolean)) {
    // Resolve the file, not just its parent: individual font files can be links.
    try {
      candidates.add(dirname(await realpath(file)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const directories = new Set();
for (const candidate of candidates) {
  try {
    const path = await realpath(candidate);
    if ((await stat(path)).isDirectory()) directories.add(path);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
}
const roots = [...directories].sort().filter(
  (path) =>
    ![...directories].some((parent) => {
      const child = relative(parent, path);
      return child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
    }),
);
if (!roots.length)
  throw new Error('No system font directories found; use the project fonts/ directory.');
const volumes = roots.map((source, index) => ({
  type: 'bind',
  source,
  target: `/host-fonts/${index}`,
  read_only: true,
  bind: { create_host_path: false },
}));
const override = resolve(project, '.compose.system-fonts.json');
await writeFile(
  override,
  JSON.stringify(
    {
      services: {
        compiler: {
          volumes,
          environment: {
            TYPST_FONT_PATHS: [...volumes.map((volume) => volume.target), '/fonts'].join(':'),
          },
        },
      },
    },
    null,
    2,
  ) + '\n',
  { mode: 0o600 },
);
console.log(
  `Discovered ${roots.length} system font directories; generated .compose.system-fonts.json.`,
);
for (const path of roots) console.log(`  ${path}`);
if (args.length === 1 && args[0] === '--print') process.exit(0);
const compose = ['compose', '-f', 'compose.yaml'];
if (!production) compose.push('-f', 'compose.local.yaml');
compose.push('-f', override, ...(args.length ? args : ['up', '-d', '--wait']));
const result = spawnSync('docker', compose, { cwd: project, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
