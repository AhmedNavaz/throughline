import { spawn } from 'node:child_process';
import { runCodex, runClaude, classifyError } from './providers.mjs';
let running = false;
let cancelled = false;
let finished = false;
const pending = new Map();
const send = value => { if (process.connected) process.send(value); };
process.on('disconnect', () => { if (!finished && process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGTERM'); } catch {} } process.exit(finished ? process.exitCode || 0 : 1); });
process.on('message', async message => {
  if (message.type === 'approval-result') { pending.get(message.id)?.(message.allow); pending.delete(message.id); return; }
  if (message.type === 'cancel') { cancelled = true; for (const resolve of pending.values()) resolve(false); pending.clear(); return; }
  if (message.type !== 'start' || running) return;
  running = true;
  const config = message.config;
  try {
    if (config.transport === 'cli') {
      const child = spawn(config.bin, config.args, { cwd: config.workspace, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      child.on('error', error => { send({ type: 'failure', message: error.message, category: classifyError(error) }); process.exitCode = 1; });
      child.on('close', (code, signal) => { process.exitCode = code ?? 1; finished = true; process.disconnect(); });
      child.stdin.on('error', () => {}); child.stdin.end(config.prompt);
      return;
    }
    const callbacks = {
      event: event => send({ type: 'event', event }),
      metadata: metadata => send({ type: 'metadata', metadata }),
      cancelled: () => cancelled,
      approval: request => new Promise(resolve => { const id = String(request.id); pending.set(id, resolve); send({ type: 'approval', request: { ...request, id } }); }),
    };
    await (config.transport === 'app-server' ? runCodex(config, callbacks) : runClaude(config, callbacks));
    send({ type: 'adapter-complete' });
  } catch (error) { send({ type: 'failure', message: error.message, category: classifyError(error) }); process.exitCode = 1; }
  finally { if (config.transport !== 'cli') { finished = true; process.disconnect(); } }
});
setTimeout(() => { if (!running) process.exit(1); }, 10000).unref();
