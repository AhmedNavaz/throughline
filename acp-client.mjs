import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ACP is newline-delimited JSON-RPC. Bound frames before parsing, and fail all
// outstanding requests on malformed output, timeout, exit or cancellation.
export class GeminiClient extends EventEmitter {
  constructor({ bin, cwd, args, env, spawnImpl = spawn }) {
    super(); this.pending = new Map(); this.counter = 0; this.closed = false;
    this.child = spawnImpl(bin, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', diagnostic = '';
    this.child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-8000); this.emit('diagnostic', diagnostic); });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) { this.fail(new Error('Oversized Gemini protocol event.')); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (!message || message.jsonrpc !== '2.0') throw new Error('Expected JSON-RPC 2.0.');
          if (message.id !== undefined && !message.method) {
            const request = this.pending.get(message.id); if (!request) continue;
            clearTimeout(request.timer); this.pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error.message || 'Gemini protocol error.'));
            else request.resolve(message.result);
          } else this.emit('message', message);
        } catch (error) { this.fail(new Error('Invalid Gemini protocol: ' + error.message)); return; }
      }
    });
    this.child.stdin.on('error', () => {});
    this.child.on('error', error => this.fail(error));
    this.child.on('close', (code, signal) => this.fail(new Error(diagnostic || `Gemini ACP closed (${code ?? signal}).`)));
  }
  send(message) { if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }
  request(method, params = {}, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error('Gemini ACP is closed.'));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Gemini protocol timed out: ' + method)); this.close(); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  fail(error) {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear(); this.close();
  }
  close() { if (!this.closed) { this.closed = true; this.child.stdin.end(); this.child.kill('SIGTERM'); } }
}
