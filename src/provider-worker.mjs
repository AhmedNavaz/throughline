import { runGemini } from './gemini.mjs';
import { spawn } from 'node:child_process';
import { runCodex, runClaude, classifyError } from './providers.mjs';
import { withBinaryPath } from './resolve-binary.mjs';
let running = false;
let cancelled = false;
let finished = false;
const pending = new Map();
const send = value => { if (process.connected) process.send(value); };
// Resolves once the message is written. IPC writes finish in order, so every earlier message has been written too.
const sendLast = value => new Promise(resolve => { if (process.connected) process.send(value, () => resolve()); else resolve(); });
process.on('disconnect', () => { if (!finished && process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGTERM'); } catch {} } process.exit(finished ? process.exitCode || 0 : 1); });
process.on('message', async message => {
  if (message.type === 'approval-result') { pending.get(message.id)?.(message.allow); pending.delete(message.id); return; }
  if (message.type === 'cancel') { cancelled = true; for (const resolve of pending.values()) resolve(false); pending.clear(); return; }
  if (message.type !== 'start' || running) return;
  running = true;
  const config = message.config;
  try {
    if (config.transport === 'cli') {
      const child = spawn(config.bin, config.args, { cwd: config.workspace, env: withBinaryPath(config.bin), shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      child.on('error', error => { send({ type: 'failure', message: error.message, category: classifyError(error) }); process.exitCode = 1; });
      // Piped output can still be queued, and disconnecting exits the worker, so wait until it is written.
      child.on('close', (code, signal) => { process.exitCode = code ?? 1; finished = true; process.stdout.write('', () => process.disconnect()); });
      child.stdin.on('error', () => {}); child.stdin.end(config.prompt);
      return;
    }
    const callbacks = {
      event: event => send({ type: 'event', event }),
      metadata: metadata => send({ type: 'metadata', metadata }),
      cancelled: () => cancelled,
      approval: request => new Promise(resolve => { const id = String(request.id); pending.set(id, resolve); send({ type: 'approval', request: { ...request, id } }); }),
    };
    await (config.transport === 'acp' ? runGemini(config, callbacks) : config.transport === 'app-server' ? runCodex(config, callbacks) : runClaude(config, callbacks));
    await sendLast({ type: 'adapter-complete' });
  } catch (error) { await sendLast({ type: 'failure', message: error.message, category: classifyError(error) }); process.exitCode = 1; }
  finally { if (config.transport !== 'cli') { finished = true; process.disconnect(); } }
});
setTimeout(() => { if (!running) process.exit(1); }, 10000).unref();
