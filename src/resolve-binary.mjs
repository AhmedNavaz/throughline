import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { googleRuntimePath } from './antigravity-install.mjs';

const variable = provider => `AI_RELAY_${provider.toUpperCase()}_BIN`;
const expandHome = (value, home) => value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;

function executable(filename) {
  try {
    if (!fs.statSync(filename).isFile()) return false;
    fs.accessSync(filename, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

function firstExecutable(candidates) {
  return candidates.find(filename => path.isAbsolute(filename) && executable(filename)) || null;
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (b[i] || 0) - (a[i] || 0);
    if (difference) return difference;
  }
  return 0;
}

function nvmBinDirs(home, env) {
  const root = path.join(env.NVM_DIR ? expandHome(env.NVM_DIR, home) : path.join(home, '.nvm'), 'versions/node');
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && /^v\d+(?:\.\d+)*$/.test(entry.name))
    .map(entry => ({ version: entry.name.slice(1).split('.').map(Number), dir: path.join(root, entry.name, 'bin') }))
    .sort((a, b) => compareVersions(a.version, b.version))
    .map(entry => entry.dir);
}

// Keep the selected binary's directory on PATH so #!/usr/bin/env node CLIs work when the desktop app starts from Finder.
export function withBinaryPath(bin, env = process.env, platform = process.platform) {
  if (typeof bin !== 'string' || !path.isAbsolute(bin)) return env;
  const key = platform === 'win32' && !('PATH' in env) && 'Path' in env ? 'Path' : 'PATH';
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const dir = path.dirname(bin), entries = (env[key] || '').split(delimiter).filter(Boolean);
  return entries.includes(dir) ? env : { ...env, [key]: [dir, ...entries].join(delimiter) };
}

function extensionExecutables(roots, platform, arch) {
  const target = {
    'darwin-arm64': 'macos-aarch64', 'darwin-x64': 'macos-x86_64',
    'linux-arm64': 'linux-aarch64', 'linux-x64': 'linux-x86_64',
    'win32-arm64': 'windows-aarch64', 'win32-x64': 'windows-x86_64',
  }[`${platform}-${arch}`];
  if (!target) return [];
  const found = [];
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const match = entry.name.match(/^openai\.chatgpt-(\d+(?:\.\d+)*)(.*)$/);
      if (!match) continue;
      const host = match[2].match(/-(darwin|linux|win32)-(arm64|x64)(?:$|-)/);
      if (host && (host[1] !== platform || host[2] !== arch)) continue;
      found.push({ version: match[1].split('.').map(Number), name: entry.name,
        filename: path.join(root, entry.name, 'bin', target, platform === 'win32' ? 'codex.exe' : 'codex') });
    }
  }
  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
      const difference = (b.version[i] || 0) - (a.version[i] || 0);
      if (difference) return difference;
    }
    return b.name.localeCompare(a.name);
  });
  return found.map(entry => entry.filename);
}

// Search installations outside the project. Empty/relative PATH entries must not
// cause a checked-out repository's executable to be selected automatically.
export function resolveBinary(provider, {
  override, googleRoot, env = process.env, home = os.homedir(), platform = process.platform, arch = process.arch,
  applicationRoots = ['/Applications', path.join(home, 'Applications')],
  extensionRoots = [path.join(home, '.vscode/extensions'), path.join(home, '.vscode-insiders/extensions')],
  systemBinDirs = ['/opt/homebrew/bin', '/usr/local/bin'],
} = {}) {
  if (!['codex', 'claude', 'gemini'].includes(provider)) throw new Error('Unknown assistant executable.');
  const explicit = override || env[variable(provider)];
  if (explicit) {
    const expanded = expandHome(explicit, home);
    if (path.isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) return expanded;
    // An explicitly selected command is never silently replaced by another tool.
    const pathEntries = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : path.delimiter)
      .filter(directory => path.isAbsolute(directory));
    return firstExecutable(pathEntries.map(directory => path.join(directory, expanded))) || expanded;
  }

  const pathEntries = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : path.delimiter)
    .filter(directory => path.isAbsolute(directory));

  if (provider === 'gemini') {
    const native = firstExecutable([...(googleRoot ? [googleRuntimePath(googleRoot)] : []), ...pathEntries.flatMap(directory => ['agy_acp_server.par', 'agy_acp_server.exe', 'antigravity-acp'].map(name => path.join(directory, name)))]);
    if (native) return native;

    const agyNames = platform === 'win32' ? ['agy.exe', 'agy', 'antigravity.exe', 'antigravity'] : ['agy', 'antigravity'];
    const agyDirs = [
      path.join(home, '.gemini/bin'),
      ...pathEntries,
      path.join(home, '.local/bin'),
      path.join(home, 'bin'),
      ...(platform === 'win32' && env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'agy/bin')] : []),
    ];
    const agy = firstExecutable(agyDirs.flatMap(directory => agyNames.map(name => path.join(directory, name))));
    if (agy) return agy;
  }

  const names = platform === 'win32' ? [`${provider}.exe`, provider] : [provider];
  const onPath = firstExecutable(pathEntries.flatMap(directory => names.map(name => path.join(directory, name))));
  if (onPath) return onPath;

  const directories = [
    ...(provider === 'gemini' ? [path.join(home, '.gemini/bin')] : []),
    ...(provider === 'codex' && env.CODEX_INSTALL_DIR ? [expandHome(env.CODEX_INSTALL_DIR, home)] : []),
    path.join(home, '.local/bin'), path.join(home, 'bin'), path.join(home, '.npm-global/bin'),
    env.VOLTA_HOME ? path.join(expandHome(env.VOLTA_HOME, home), 'bin') : path.join(home, '.volta/bin'),
    env.PNPM_HOME ? expandHome(env.PNPM_HOME, home) : platform === 'darwin' ? path.join(home, 'Library/pnpm') : path.join(home, '.local/share/pnpm'),
    env.BUN_INSTALL ? path.join(expandHome(env.BUN_INSTALL, home), 'bin') : path.join(home, '.bun/bin'),
    path.join(home, '.local/share/mise/shims'), path.join(home, '.asdf/shims'),
    path.join(home, '.local/share/fnm/aliases/default/bin'), path.join(home, 'Library/Application Support/fnm/aliases/default/bin'),
    ...nvmBinDirs(home, env),
    ...systemBinDirs,
  ];
  if (platform === 'win32') {
    const winDirs = [path.join(home, '.gemini/bin')];
    if (env.LOCALAPPDATA) {
      winDirs.push(path.join(env.LOCALAPPDATA, 'Programs/OpenAI/Codex/bin'), path.join(env.LOCALAPPDATA, 'Volta/bin'), path.join(env.LOCALAPPDATA, 'pnpm'), path.join(env.LOCALAPPDATA, 'agy/bin'));
    }
    directories.unshift(...winDirs);
  }
  const standard = firstExecutable(directories.flatMap(directory => names.map(name => path.join(directory, name))));
  if (standard) return standard;
  if (provider === 'codex' && platform === 'darwin') {
    const bundled = firstExecutable(applicationRoots.flatMap(directory => ['ChatGPT.app', 'Codex.app'].flatMap(app => [
      path.join(directory, app, 'Contents/Resources/codex-cli/bin/codex'),
      path.join(directory, app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
      path.join(directory, app, 'Contents/Resources/codex'),
    ])));
    if (bundled) return bundled;
  }
  return provider === 'codex' ? firstExecutable(extensionExecutables(extensionRoots, platform, arch)) : null;
}

// Finder launches have a minimal PATH. Project commands need the user's Node/package
// manager installations, but never resolve executables from an empty/relative entry.
export function commandEnvironment(env = process.env, home = os.homedir()) {
  const result = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('AI_RELAY_') && !['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'].includes(key)));
  const key = process.platform === 'win32' && !('PATH' in result) && 'Path' in result ? 'Path' : 'PATH';
  const directories = (result[key] || '').split(path.delimiter).filter(value => path.isAbsolute(value));
  result[key] = [...new Set([...directories, ...nvmBinDirs(home, env), path.join(home, '.volta/bin'), path.join(home, '.bun/bin'), path.join(home, 'Library/pnpm'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(path.delimiter);
  return result;
}
