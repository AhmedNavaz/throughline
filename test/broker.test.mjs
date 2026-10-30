import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { Broker, commandFor } from '../broker.mjs';

const fixture = fileURLToPath(new URL('./mock-cli.mjs', import.meta.url));

function setup(t, scenarios = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-relay-test-'));
  const workspace = path.join(root, 'workspace with spaces');
  const dataDir = path.join(root, 'private-data');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, '.mock-scenarios.json'), JSON.stringify(scenarios));
  fs.writeFileSync(path.join(workspace, 'project.txt'), 'A local mock project.');
  const bins = {};
  for (const provider of ['codex', 'claude']) {
    bins[provider] = path.join(root, `${provider}-mock.mjs`);
    fs.writeFileSync(bins[provider], `#!${process.execPath}\nimport ${JSON.stringify(pathToFileURL(fixture).href)};\n`, { mode: 0o700 });
  }
  const options = { workspace, dataDir, bins };
  const brokers = [];
  function open() {
    const broker = new Broker(options);
    brokers.push(broker);
    return broker;
  }
  t.after(async () => {
    await Promise.all(brokers.map(broker => broker.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { ...options, open, captures: () => {
    const filename = path.join(workspace, '.mock-captures.jsonl');
    return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  } };
}

function conversation(broker) {
  return broker.get(broker.create().id);
}

async function run(broker, c, text, provider, extra = {}) {
  const result = broker.start(c, { text, provider, mode: 'edit', ...extra });
  const active = broker.running;
  assert.equal(result.runId, active.id);
  await active.done;
  return result;
}

async function untilUpdate(broker, predicate) {
  if (predicate()) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for mock provider output.')); }, 5000);
    const check = () => { if (predicate()) { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); broker.off('update', check); };
    broker.on('update', check);
    check();
  });
}

test('switching Codex → Claude → Codex preserves history and resumes each native session', async t => {
  const env = setup(t);
  let broker = env.open();
  let c = conversation(broker);
  const id = c.id;

  await run(broker, c, 'Build the first part', 'codex');
  assert.equal(c.status, 'complete');
  assert.equal(c.sessions.codex.id, 'codex-test-session');
  assert.ok(c.sessions.codex.cursor > 0);
  await run(broker, c, 'Improve it with Claude', 'claude');

  const claude = env.captures()[1];
  assert.equal(claude.provider, 'claude');
  assert.equal(claude.cwd, fs.realpathSync(env.workspace));
  assert.ok(claude.context.context.some(m => m.role === 'assistant' && m.text === 'Codex: Build the first part'));
  assert.ok(claude.context.context.some(m => m.role === 'activity' && m.text.includes('project inspection retained')));
  assert.equal(claude.args.includes('--resume'), false);
  assert.equal(c.messages.filter(m => m.provider === 'claude' && m.role === 'assistant').length, 1, 'Claude deltas and final message must merge');
  assert.ok(c.messages.some(m => m.role === 'activity' && m.text.includes('Claude project inspection retained')));

  await broker.close();
  broker = env.open();
  c = broker.get(id);
  await run(broker, c, 'Finish with Codex', 'codex');
  const resumedCodex = env.captures()[2];
  assert.deepEqual(resumedCodex.args.slice(resumedCodex.args.indexOf('resume'), resumedCodex.args.indexOf('resume') + 2), ['resume', 'codex-test-session']);
  assert.ok(resumedCodex.context.context.some(m => m.text === 'Claude: Improve it with Claude'));
  assert.ok(resumedCodex.context.context.some(m => m.text.includes('Claude project inspection retained')));
  assert.equal(resumedCodex.context.context.some(m => m.text === 'Codex: Build the first part'), false, 'already checkpointed native history should not be replayed');
  assert.equal(resumedCodex.context.currentRequest, 'Finish with Codex');

  await run(broker, c, 'Review once more', 'claude');
  const resumedClaude = env.captures()[3];
  assert.equal(resumedClaude.args[resumedClaude.args.indexOf('--resume') + 1], 'claude-test-session');
  assert.ok(resumedClaude.context.context.some(m => m.text === 'Codex: Finish with Codex'));
  assert.equal(resumedClaude.context.context.some(m => m.text === 'Claude: Improve it with Claude'), false);
  assert.equal(c.status, 'complete');
  assert.equal(broker.running, null);
  assert.equal('sessions' in broker.view(c), false);
});

test('quota failure retains partial text and tool activity without committing its cursor', async t => {
  const env = setup(t, { 'Hit the limit': { behavior: 'quota', text: 'I changed the first file, then stopped' } });
  const broker = env.open();
  const c = conversation(broker);
  await run(broker, c, 'Successful checkpoint', 'codex');
  const cursor = c.sessions.codex.cursor;
  const { runId } = await run(broker, c, 'Hit the limit', 'codex');

  assert.equal(c.status, 'incomplete');
  assert.equal(c.sessions.codex.cursor, cursor);
  assert.ok(c.messages.some(m => m.runId === runId && m.role === 'assistant' && m.status === 'incomplete' && m.text === 'I changed the first file, then stopped'));
  assert.ok(c.messages.some(m => m.runId === runId && m.role === 'activity' && m.text.includes('project inspection retained')));
  assert.ok(c.messages.some(m => m.runId === runId && m.role === 'error' && /Usage limit reached/.test(m.text)));

  await run(broker, c, 'Continue after the limit', 'claude');
  const shared = env.captures().at(-1).context.context;
  assert.ok(shared.some(m => m.text === 'I changed the first file, then stopped' && m.status === 'incomplete'));
  assert.ok(shared.some(m => m.role === 'activity' && m.text.includes('project inspection retained')));
});

test('restart recovers an unfinished run and repairs a torn final journal line', async t => {
  const env = setup(t);
  const broker = env.open();
  const c = conversation(broker);
  await run(broker, c, 'Save a checkpoint', 'codex');
  const cursor = c.sessions.codex.cursor;
  broker.record(c, { type: 'run_start', id: 'interrupted-run', provider: 'codex' });
  broker.message(c, 'assistant', 'Saved before the process crashed', 'codex', 'crash-message', 'streaming');
  const filename = path.join(env.dataDir, `${c.id}.jsonl`);
  fs.appendFileSync(filename, '{"type":"message_update"');

  const restarted = env.open();
  const recovered = restarted.get(c.id);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.activeRun, null);
  assert.equal(recovered.sessions.codex.cursor, cursor);
  assert.equal(recovered.messages.find(m => m.id === 'crash-message').status, 'incomplete');
  assert.ok(recovered.messages.some(m => m.role === 'error' && /previous run was interrupted/.test(m.text)));
  for (const line of fs.readFileSync(filename, 'utf8').trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line));

  await run(restarted, recovered, 'Continue after restarting', 'claude');
  assert.ok(env.captures().at(-1).context.context.some(m => m.text === 'Saved before the process crashed' && m.status === 'incomplete'));
});

test('a failed journal append is cut off so later records still load after a restart', t => {
  const env = setup(t);
  const broker = env.open();
  const c = conversation(broker);
  const { writeSync, fsyncSync } = fs;
  t.after(() => Object.assign(fs, { writeSync, fsyncSync }));
  // The disk fills partway through a record.
  let writes = 0;
  fs.writeSync = (fd, buffer, offset, length) => {
    if (writes++) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    return writeSync(fd, buffer, offset, Math.ceil(length / 2));
  };
  assert.throws(() => broker.message(c, 'user', 'Lost when the disk filled', 'codex'), { code: 'ENOSPC' });
  fs.writeSync = writeSync;
  fs.fsyncSync = () => { throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' }); };
  assert.throws(() => broker.message(c, 'user', 'Written but never synced', 'codex'), { code: 'EIO' });
  fs.fsyncSync = fsyncSync;
  broker.message(c, 'user', 'Saved after the disk recovered', 'codex');

  for (const line of fs.readFileSync(path.join(env.dataDir, `${c.id}.jsonl`), 'utf8').trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
  assert.deepEqual(env.open().get(c.id).messages.map(m => m.text), ['Saved after the disk recovered']);
});

test('a journal left without a complete record does not stop the workspace from opening', t => {
  const env = setup(t);
  const kept = conversation(env.open());
  // A crash or a full disk while a new conversation writes its first record.
  fs.writeFileSync(path.join(env.dataDir, '00000000-0000-4000-8000-000000000001.jsonl'), '');
  fs.writeFileSync(path.join(env.dataDir, '00000000-0000-4000-8000-000000000002.jsonl'), '{"type":"created","title":"New conv');

  assert.deepEqual(env.open().list().map(row => row.id), [kept.id]);
});

test('signalling an exited process group on macOS counts as stopped, not as an error', t => {
  const kill = process.kill, platform = Object.getOwnPropertyDescriptor(process, 'platform');
  t.after(() => { process.kill = kill; Object.defineProperty(process, 'platform', platform); });
  process.kill = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }); };
  const run = { child: { pid: 4242, kill() {} } };
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  assert.doesNotThrow(() => Broker.prototype.signal.call(null, run, 'SIGKILL'), 'macOS returns EPERM while the exited group awaits reaping.');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  assert.throws(() => Broker.prototype.signal.call(null, run, 'SIGKILL'), { code: 'EPERM' }, 'Elsewhere EPERM is a real permission error.');
});

test('rejects concurrent turns and preserves partial output when cancelled', async t => {
  const env = setup(t, { 'Keep working': { behavior: 'hang', text: 'Partial work before cancellation' } });
  const broker = env.open();
  const c = conversation(broker);
  const other = conversation(broker);
  const { runId } = broker.start(c, { text: 'Keep working', provider: 'codex', mode: 'edit' });
  const active = broker.running;
  await untilUpdate(broker, () => c.messages.some(m => m.role === 'activity'));
  if (process.platform !== 'win32') {
    assert.throws(() => env.open(), /previous run may still be active/, 'restart must refuse an assistant process group that is still running');
  }
  assert.throws(() => broker.start(other, { text: 'Run concurrently', provider: 'claude', mode: 'edit' }), { status: 409 });
  assert.throws(() => broker.settings(c, { provider: 'claude' }), { status: 409 });
  assert.deepEqual(broker.stop(other.id), { stopped: false });
  assert.equal(broker.running, active);
  assert.deepEqual(broker.stop(c.id), { stopped: true });
  const completion = await active.done;
  assert.equal(completion.error, undefined, completion.error);

  assert.equal(c.status, 'interrupted');
  assert.equal(c.activeRun, null);
  assert.equal(broker.running, null);
  assert.equal(c.sessions.codex.cursor, 0);
  assert.ok(c.messages.some(m => m.runId === runId && m.role === 'assistant' && m.status === 'incomplete' && m.text === 'Partial work before cancellation'));
  assert.ok(c.messages.some(m => m.role === 'error' && /Files already changed/.test(m.text)));
  assert.deepEqual(broker.stop(c.id), { stopped: false });
  await run(broker, other, 'Start after stopping', 'claude');
  assert.equal(other.status, 'complete');
});

test('requires both a successful terminal event and a successful process exit', async t => {
  const env = setup(t, {
    'Missing terminal event': { behavior: 'no-terminal' },
    'Terminal but bad exit': { behavior: 'bad-exit' },
    'Permission denied': { behavior: 'permission-denied' },
  });
  const broker = env.open();
  const c = conversation(broker);
  for (const text of ['Missing terminal event', 'Terminal but bad exit']) {
    await run(broker, c, text, 'codex');
    assert.equal(c.status, 'incomplete');
    assert.equal(c.sessions.codex.cursor, 0);
  }
  await run(broker, c, 'Permission denied', 'claude');
  assert.equal(c.status, 'incomplete');
  assert.equal(c.sessions.claude.cursor, 0);
  assert.ok(c.messages.some(m => m.role === 'error' && /needs approval/.test(m.text)));
});

test('a recovered Codex connection diagnostic does not fail a completed turn', async t => {
  const env = setup(t, { 'Recover the connection': { behavior: 'reconnect' } });
  const broker = env.open();
  const c = conversation(broker);
  await run(broker, c, 'Recover the connection', 'codex');
  assert.equal(c.status, 'complete');
  assert.ok(c.sessions.codex.cursor > 0);
  assert.ok(c.messages.some(m => m.role === 'activity' && /Reconnecting/.test(m.text)));
  assert.equal(c.messages.some(m => m.role === 'error'), false);
  assert.ok(c.messages.some(m => m.role === 'assistant' && m.status === 'complete'));
});

test('fresh sessions replay shared history and omit native resume flags', async t => {
  const env = setup(t);
  const broker = env.open();
  const c = conversation(broker);
  await run(broker, c, 'Prior task', 'codex');
  await run(broker, c, 'Fresh context', 'codex', { fresh: true });
  const capture = env.captures().at(-1);
  assert.equal(capture.args.includes('resume'), false);
  assert.ok(capture.context.context.some(m => m.text === 'Codex: Prior task'));
});

test('command construction preserves CLI permissions and passes paths without a shell', () => {
  const codex = commandFor('codex', { mode: 'read', sessionId: 'thread-123', bin: '/a path/codex' });
  assert.equal(codex.bin, '/a path/codex');
  assert.deepEqual(codex.args, ['--ask-for-approval', 'never', '--sandbox', 'read-only', 'exec', 'resume', 'thread-123', '--json', '-']);
  const claude = commandFor('claude', { mode: 'read', sessionId: 'session-123' });
  assert.equal(claude.args[claude.args.indexOf('--permission-mode') + 1], 'plan');
  assert.equal(claude.args[claude.args.indexOf('--tools') + 1], 'Read,Glob,Grep');
  assert.equal(claude.args[claude.args.indexOf('--resume') + 1], 'session-123');
  assert.ok(claude.args.includes('--strict-mcp-config'));
  assert.deepEqual(JSON.parse(claude.args[claude.args.indexOf('--mcp-config') + 1]), { mcpServers: {} });
  assert.equal(claude.args.some(arg => /dangerously|skip-permissions|bypass/.test(arg)), false);
  assert.throws(() => commandFor('unknown', { mode: 'edit' }), { status: 400 });
});
