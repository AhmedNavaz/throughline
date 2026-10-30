import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { accountStatus } from '../providers.mjs';

function fixture(t, { stage = '', output = '{"loggedIn":true,"authMethod":"oauth"}', code = 0, authCode = 0, wait = 3000, keep = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'throughline-probes-'));
  const bin = path.join(root, 'fake-cli');
  fs.writeFileSync(bin, `#!${process.execPath}\nconst fs = require('node:fs');
const root = ${JSON.stringify(root)}, stage = process.argv[2] === '--version' ? 'version' : 'auth';
fs.appendFileSync(root + '/calls', stage + '\\n');
if (stage === ${JSON.stringify(stage)}) {
  fs.writeFileSync(root + '/started', String(process.pid));
  const until = Date.now() + ${wait};
  while (!fs.existsSync(root + '/release') && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
process.stdout.write(stage === 'version' ? '  fake 1.0\\n' : ${JSON.stringify(output)});
process.exit(stage === 'version' ? ${code} : ${authCode});\n`, { mode: 0o755 });
  if (!keep) t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, bin };
}
async function waitFor(filename) {
  for (let i = 0; i < 500; i++) { if (fs.existsSync(filename)) return; await delay(10); }
  assert.fail('Fake CLI did not start');
}
for (const [route, stage] of [['/api/providers/claude/account', 'version'], ['/api/providers/claude/account', 'auth'], ['/api/status', 'version']]) {
  test(`${route} keeps HTTP responsive during ${stage}`, async t => {
    const f = fixture(t, { stage, keep: true });
    const child = fork(new URL('./fixtures/status-server.mjs', import.meta.url), [], { env: { ...process.env, TEST_ROOT: f.root, AI_RELAY_CLAUDE_BIN: f.bin, AI_RELAY_CODEX_BIN: f.bin }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(async () => {
      fs.writeFileSync(f.root + '/release', '');
      if (child.exitCode === null) { child.send('close'); await once(child, 'exit'); }
      fs.rmSync(f.root, { recursive: true, force: true });
    });
    const [ready] = await once(child, 'message');
    const base = `http://127.0.0.1:${ready.port}`;
    const pending = fetch(base + route).then(r => r.json());
    const concurrent = route === '/api/status' ? fetch(base + route).then(r => r.json()) : null;
    await waitFor(f.root + '/started');
    try {
      const response = await fetch(base + '/api/projects', { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 200);
      assert.equal(fs.existsSync(f.root + '/release'), false);
      assert.doesNotThrow(() => process.kill(Number(fs.readFileSync(f.root + '/started', 'utf8')), 0), 'probe remains alive behind the release barrier');
    } finally { fs.writeFileSync(f.root + '/release', ''); }
    const result = await pending;
    if (concurrent) assert.deepEqual((await concurrent).providers, result.providers);
    assert.equal(route === '/api/status' ? result.providers.claude.available : result.installed, true);
    if (route === '/api/status') {
      await fetch(base + route);
      assert.equal(fs.readFileSync(f.root + '/calls', 'utf8').trim().split('\n').length, 2, 'warm cache does not spawn again');
    }
  });
}
test('account probe preserves version, authentication and malformed/error results', async t => {
  const good = fixture(t);
  const result = await accountStatus('claude', { bin: good.bin });
  assert.equal(result.version, 'fake 1.0'); assert.equal(result.authenticated, true); assert.equal(result.billingSource, 'subscription');
  const malformed = fixture(t, { output: 'not json' });
  assert.equal((await accountStatus('claude', { bin: malformed.bin })).authenticated, 'unknown');
  const failed = fixture(t, { code: 1 });
  assert.equal((await accountStatus('claude', { bin: failed.bin })).errorCategory, 'installation');
  assert.equal((await accountStatus('claude', { bin: good.root + '/missing' })).errorCategory, 'installation');
});

for (const stage of ['version', 'auth']) {
  test(`account ${stage} timeout kills the child and preserves the result category`, async t => {
    const f = fixture(t, { stage, wait: 15000 });
    const pending = accountStatus('claude', { bin: f.bin });
    await waitFor(f.root + '/started');
    const pid = Number(fs.readFileSync(f.root + '/started', 'utf8'));
    const result = await pending;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    if (stage === 'version') assert.equal(result.errorCategory, 'installation');
    else { assert.equal(result.installed, true); assert.equal(result.authenticated, 'unknown'); }
  });
}
test('Claude auth nonzero output keeps the existing parse behavior', async t => {
  const f = fixture(t, { authCode: 1, output: '{"loggedIn":false,"authMethod":"api_key"}' });
  const result = await accountStatus('claude', { bin: f.bin });
  assert.equal(result.installed, true); assert.equal(result.authenticated, false); assert.equal(result.billingSource, 'api');
});
