import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  override, env = process.env, home = os.homedir(), platform = process.platform, arch = process.arch,
  applicationRoots = ['/Applications', path.join(home, 'Applications')],
  extensionRoots = [path.join(home, '.vscode/extensions'), path.join(home, '.vscode-insiders/extensions')],
  systemBinDirs = ['/opt/homebrew/bin', '/usr/local/bin'],
} = {}) {
  if (!['codex', 'claude'].includes(provider)) throw new Error('Unknown assistant executable.');
  const names = platform === 'win32' ? [`${provider}.exe`, provider] : [provider];
  const pathEntries = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : path.delimiter)
    .filter(directory => path.isAbsolute(directory));
  const onPath = firstExecutable(pathEntries.flatMap(directory => names.map(name => path.join(directory, name))));
  const explicit = override || env[variable(provider)];
  if (explicit) {
    const expanded = expandHome(explicit, home);
    if (path.isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) return expanded;
    // An explicitly selected command is never silently replaced by another tool.
    return firstExecutable(pathEntries.map(directory => path.join(directory, expanded))) || expanded;
  }
  if (onPath) return onPath;

  const directories = [
    ...(provider === 'codex' && env.CODEX_INSTALL_DIR ? [expandHome(env.CODEX_INSTALL_DIR, home)] : []),
    path.join(home, '.local/bin'), path.join(home, 'bin'), path.join(home, '.npm-global/bin'),
    ...systemBinDirs,
  ];
  if (platform === 'win32' && env.LOCALAPPDATA) directories.unshift(path.join(env.LOCALAPPDATA, 'Programs/OpenAI/Codex/bin'));
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
