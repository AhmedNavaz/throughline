import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function launchDesktop({ args = [], env = process.env, spawnImpl = spawn } = {}) {
  const childEnv = { ...env };
  // IDEs and coding agents can inherit this from their own Electron runtime.
  // It is appropriate for provider workers, but prevents the desktop app opening.
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return spawnImpl(electron, [root, ...args], { stdio: 'inherit', env: childEnv });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const temporary = args.includes('--smoke-test') ? fs.mkdtempSync(path.join(os.tmpdir(), 'ai-relay-desktop-smoke-')) : null;
  const env = temporary ? { ...process.env, AI_RELAY_DESKTOP_DATA: path.join(temporary, 'profile'), AI_RELAY_LEGACY_DATA_DIR: path.join(temporary, 'no-legacy-data') } : process.env;
  const child = launchDesktop({ args, env });
  const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.on('error', error => { console.error(`Could not launch Throughline: ${error.message}`); process.exitCode = 1; });
  child.on('close', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  });
}
