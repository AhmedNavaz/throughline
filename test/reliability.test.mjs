import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { Broker } from '../broker.mjs';
import { ProjectRegistry } from '../projects.mjs';
import { MutationCoordinator, withFileGuard } from '../mutation-lock.mjs';
import { prepareContext } from '../context.mjs';
import { runCodex, runClaude, classifyError, CodexClient } from '../providers.mjs';

test('overlapping workspaces exclude mutations even with different history roots',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-cross-root-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const child=path.join(root,'workspace','child');fs.mkdirSync(child,{recursive:true});
  const first=new MutationCoordinator(path.join(root,'one'));
  const second=new MutationCoordinator(path.join(root,'two'));
  const lease=first.acquire(path.dirname(child),'provider');
  try {assert.throws(()=>second.acquire(child,'patch'),/overlapping workspace/);}finally{lease.release();}
  const next=second.acquire(child,'patch');next.release();
});

test('overlapping workspaces exclude mutations when a folder is typed in another letter case',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'relay-case-root-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const shop=path.join(root,'Shop');fs.mkdirSync(path.join(shop,'backend'),{recursive:true});
  if(!fs.existsSync(path.join(root,'shop')))return t.skip('This file system distinguishes letter case.');
  const coordinator=new MutationCoordinator(path.join(root,'data'));
  const lease=coordinator.acquire(shop,'provider');
  try {assert.throws(()=>coordinator.acquire(path.join(root,'shop','BACKEND'),'patch'),/overlapping workspace/);}finally{lease.release();}
});

test('a lease saved with a folder typed in another letter case still excludes overlapping mutations',t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'relay-case-lease-')));
  const coordinator=new MutationCoordinator(path.join(root,'data')),saved=path.join(coordinator.root,`relay-case-lease-${process.pid}.json`);
  // Other test files take leases in this shared folder at the same time. Change it under the application's guard, so they never read a half-written or removed lease.
  const guarded=callback=>withFileGuard(path.join(coordinator.root,'coordinator'),callback);
  t.after(()=>{guarded(()=>fs.rmSync(saved,{force:true}));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'Shop','Backend'),{recursive:true});
  if(!fs.existsSync(path.join(root,'shop')))return t.skip('This file system distinguishes letter case.');
  // Earlier versions saved a lease's folders as they were typed. This one belongs to a live instance.
  guarded(()=>fs.writeFileSync(saved,JSON.stringify({id:'before-the-upgrade',workspace:path.join(root,'shop'),workspaces:[path.join(root,'shop')],operation:'provider:codex',pid:process.pid,processGroup:null,createdAt:new Date().toISOString()})));
  assert.throws(()=>coordinator.acquire(path.join(root,'shop','Backend'),'patch'),/overlapping workspace/);
  assert.ok(fs.existsSync(saved),'The saved lease still belongs to its instance.');
});

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-reliability-'));
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, '.mock-scenarios.json'), '{}');
  const bins = {};
  for (const provider of ['codex', 'claude']) {
    bins[provider] = path.join(root, `${provider}.mjs`);
    fs.writeFileSync(bins[provider], `#!${process.execPath}\nimport ${JSON.stringify(new URL('./mock-cli.mjs', import.meta.url).href)};\n`, { mode: 0o700 });
  }
  const instances = [];
  const broker = () => { const value = new Broker({ workspace, dataDir: path.join(root, 'history'), bins }); instances.push(value); return value; };
  const registry = () => { const value = new ProjectRegistry({ dataRoot: path.join(root, 'registry'), bins }); instances.push(value); return value; };
  t.after(async () => { for (const item of instances) await item.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspace, bins, broker, registry };
}
test('validation is atomic, long history is bounded, and request IDs deduplicate accepted runs across restart', async t => {
  const f = setup(t); let broker = f.broker(); let c = broker.get(broker.create().id);
  const before = fs.readFileSync(path.join(f.root, 'history', `${c.id}.jsonl`), 'utf8');
  assert.throws(() => broker.start(c, { text: '🧠'.repeat(50000), requestId: 'oversize' }), { status: 400 });
  assert.equal(fs.readFileSync(path.join(f.root, 'history', `${c.id}.jsonl`), 'utf8'), before);
  broker.message(c, 'user', 'old'.repeat(400000));
  broker.updateContext(c, { summary: 'Manual continuity', goal: 'Finish work', decisions: ['Keep existing user edits'], tasks: ['Verify result'] });
  const prepared = prepareContext(c, 'New request', { workspace: f.workspace, fresh: true });
  assert.ok(Buffer.byteLength(prepared.prompt) < 192000);
  assert.match(prepared.prompt, /Manual continuity/);
  const first = broker.start(c, { text: 'Deduplicated work', provider: 'codex', requestId: 'request-one' });
  const active = broker.running;
  assert.equal(broker.start(c, { text: 'Deduplicated work', provider: 'codex', requestId: 'request-one' }).runId, first.runId);
  assert.throws(() => broker.start(c, { text: 'Different work', provider: 'codex', requestId: 'request-one' }), { status: 409 });
  await active.done; await broker.close();
  broker = f.broker(); c = broker.get(c.id);
  const duplicate = broker.start(c, { text: 'Deduplicated work', provider: 'codex', requestId: 'request-one' });
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.runId, first.runId); assert.equal(broker.running, null);
  assert.equal(c.messages.filter(m => m.text === 'Deduplicated work').length, 1);
  assert.equal(c.context.goal, 'Finish work'); assert.equal(c.lastRun.baseline.git, false);
});
test('stream persistence stores deltas and replays legacy snapshot records', async t => {
  const f = setup(t); const broker = f.broker(); const c = broker.get(broker.create().id);
  const id = broker.message(c, 'assistant', 'A', 'claude', 'stream', 'streaming');
  for (let index = 2; index <= 200; index++) broker.message(c, 'assistant', 'A'.repeat(index), 'claude', id, 'streaming');
  const lines = fs.readFileSync(path.join(f.root, 'history', `${c.id}.jsonl`), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.filter(record => record.type === 'message_delta').length, 199);
  assert.equal(lines.filter(record => record.type === 'message_delta').reduce((sum, record) => sum + record.text.length, 0), 199);
  broker.record(c, { type: 'message_update', id, update: { text: 'Legacy snapshot', status: 'complete' } });
  await broker.close(); const reopened = f.broker(); assert.equal(reopened.get(c.id).messages[0].text, 'Legacy snapshot');
});
test('registry merges stale instances and overlapping mutations exclude provider runs and patches', async t => {
  const f = setup(t); const nested = path.join(f.workspace, 'nested'); fs.mkdirSync(nested);
  const first = f.registry(); const second = f.registry();
  const parent = first.add({ path: f.workspace, name: 'Parent' });
  const child = second.add({ path: nested, name: 'Child' });
  assert.equal(first.list().length, 2); assert.equal(second.list().length, 2);
  second.add({ path: f.workspace, name: 'Renamed' }); assert.equal(first.get(parent.id).name, 'Renamed');
  let release; const barrier = new Promise(resolve => { release = resolve; });
  const held = first.withMutation(parent.id, 'verification', () => barrier);
  await assert.rejects(second.withMutation(child.id, 'patch', async () => {}), { status: 409 });
  const broker = first.broker(parent.id); const c = broker.get(broker.create().id);
  assert.throws(() => broker.start(c, { text: 'Do work', provider: 'codex' }), { status: 409 });
  assert.equal(c.messages.length, 0);
  release(); await held;
  await second.withMutation(child.id, 'patch', async () => {});
});

test('a mutation lease left by a crash is cleared once its process IDs belong to newer processes', t => {
  if (process.platform !== 'darwin') return t.skip('Only macOS reports when a process started on the wall clock.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-reused-pid-'));
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
  const coordinator = new MutationCoordinator(path.join(root, 'history'));
  const other = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
  const stale = path.join(coordinator.root, `${randomUUID()}.json`);
  t.after(() => { other.kill(); fs.rmSync(stale, { force: true }); fs.rmSync(root, { recursive: true, force: true }); });
  const exited = spawnSync('/usr/bin/true').pid, written = new Date(Date.now() - 60 * 60 * 1000);
  // The crashed instance's own process ID, then the process group of its assistant.
  for (const owner of [{ pid: other.pid, processGroup: null }, { pid: exited, processGroup: other.pid }]) {
    fs.writeFileSync(stale, JSON.stringify({ id: 'left-by-a-crash', workspace: fs.realpathSync(workspace), workspaces: [fs.realpathSync(workspace)], operation: 'provider:codex', ...owner, createdAt: written.toISOString() }));
    assert.throws(() => coordinator.acquire(workspace, 'patch'), /Project files are busy/, 'The process started before its lease was written.');
    fs.utimesSync(stale, written, written);
    coordinator.acquire(workspace, 'patch').release();
    assert.equal(fs.existsSync(stale), false);
  }
});
test('Codex official JSON-RPC approvals return decisions and respect native access/model settings', async () => {
  class FakeClient extends EventEmitter {
    sent = []; requests = [];
    async initialize() {}
    async request(method, params) {
      this.requests.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'native-thread' }, model: 'reported-model' };
      if (method === 'turn/start') {
        setTimeout(() => this.emit('message', { id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'native-thread', command: 'npm test' } }), 1);
        return { turn: { id: 'native-turn' } };
      }
    }
    send(message) { this.sent.push(message); if (message.id === 99) this.emit('message', { method: 'turn/completed', params: { turn: { status: 'completed' } } }); }
    close() {}
  }
  const client = new FakeClient(); const metadata = []; const events = []; let approvals = 0;
  await runCodex({ bin: '/unused', workspace: '/project', mode: 'edit', prompt: 'Run tests', model: 'selected-model' }, {
    clientFactory: () => client, event: value => events.push(value), metadata: value => metadata.push(value), approval: async request => { approvals++; assert.equal(request.command, 'npm test'); return true; },
  });
  assert.equal(approvals, 1); assert.deepEqual(client.sent[0], { id: 99, result: { decision: 'accept' } });
  assert.equal(client.requests.find(row => row.method === 'thread/start').params.sandbox, 'workspace-write'); assert.equal(client.requests.find(row => row.method === 'thread/start').params.approvalsReviewer, 'user');
  assert.equal(client.requests.find(row => row.method === 'turn/start').params.model, 'selected-model'); assert.equal(metadata[0].effectiveModel, 'reported-model');
  assert.ok(events.some(event => event.type === 'turn.completed'));
});
test('Claude official SDK approval callback uses installed binary and excludes repository hook/settings sources', async () => {
  let captured; let approvals = 0;
  async function* queryImpl(input) {
    captured = input.options;
    const allowed = await input.options.canUseTool('Bash', { command: 'npm test' }, { toolUseID: 'approval-one' });
    assert.equal(allowed.behavior, 'allow'); assert.deepEqual(allowed.updatedInput, { command: 'npm test' });
    yield { type: 'system', subtype: 'init', model: 'effective-claude' };
    yield { type: 'result', subtype: 'success', is_error: false, result: 'Done' };
  }
  await runClaude({ bin: '/installed/unmodified/claude', workspace: '/project', mode: 'edit', prompt: 'Run tests' }, {
    queryImpl, event() {}, metadata() {}, approval: async request => { approvals++; assert.equal(request.id, 'approval-one'); return true; },
  });
  assert.equal(captured.pathToClaudeCodeExecutable, '/installed/unmodified/claude');
  assert.equal(captured.permissionMode, 'default'); assert.deepEqual(captured.settingSources, []); assert.equal(captured.settings.disableAllHooks, true); assert.equal(approvals, 1);
});
test('error categories distinguish unavailable account causes', () => {
  assert.equal(classifyError('UsageLimitExceeded'), 'quota'); assert.equal(classifyError("You've hit your limit · resets later"), 'quota'); assert.equal(classifyError('401 unauthorized'), 'authentication');
  assert.equal(classifyError({ message: 'Turn failed', codexErrorInfo: 'UsageLimitExceeded' }), 'quota');
  assert.equal(classifyError({ code: 'ENOENT' }), 'installation'); assert.equal(classifyError('permission denied'), 'permission');
  assert.equal(classifyError('invalid JSON protocol'), 'protocol');
});

test('Broker GUI approval traverses its worker and actual Codex JSON-RPC adapter before execution', async t => {
  const f = setup(t); const log = path.join(f.root, 'rpc.jsonl');
  fs.writeFileSync(f.bins.codex, `#!${process.execPath}\nimport fs from 'node:fs';import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('approval-fixture 1');process.exit(0);}
const send=value=>console.log(JSON.stringify(value));
readline.createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(message)+'\\n');
if(message.method==='initialize')send({id:message.id,result:{}});
if(message.method==='model/list')send({id:message.id,result:{data:[]}});
if(message.method==='thread/start')send({id:message.id,result:{thread:{id:'approval-thread'},model:'actual-model'}});
if(message.method==='turn/start'){send({id:message.id,result:{turn:{id:'approval-turn'}}});send({id:77,method:'item/commandExecution/requestApproval',params:{threadId:'approval-thread',turnId:'approval-turn',command:'reviewed-command',cwd:process.cwd()}});}
if(message.id===77&&message.result){send({method:'item/completed',params:{threadId:'approval-thread',item:{id:'answer',type:'agentMessage',text:message.result.decision==='accept'?'Approved action finished':'Action declined'}}});send({method:'turn/completed',params:{threadId:'approval-thread',turn:{status:'completed'}}});}
});\n`);
  const broker = f.broker(); const c = broker.get(broker.create().id);
  const { runId } = broker.start(c, { text: 'Ask before action', provider: 'codex', transport: 'app-server', requestId: 'real-adapter-approval' });
  const active = broker.running;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { broker.off('update', check); reject(new Error('No approval arrived.')); }, 5000);
    const check = () => { if (broker.view(c).pendingApprovals.length) { clearTimeout(timer); broker.off('update', check); resolve(); } };
    broker.on('update', check); check();
  });
  assert.equal(c.messages.some(m => m.text === 'Approved action finished'), false);
  const pending = broker.view(c).pendingApprovals[0]; assert.equal(pending.command, 'reviewed-command'); assert.equal(pending.runId, runId);
  assert.deepEqual(broker.approve(runId, pending.id, true), { resolved: true });
  await active.done;
  assert.equal(c.status, 'complete'); assert.equal(c.lastRun.effectiveModel, 'actual-model');
  assert.ok(c.messages.some(m => m.text === 'Approved action finished'));
  assert.throws(() => broker.approve(runId, pending.id, true), { status: 409 });
  const messages = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(messages.find(message => message.id === 77).result, { decision: 'accept' });
});

test('a long final Codex answer reaches the broker before its worker exits', async t => {
  const f = setup(t);
  // The final item is far larger than a pipe buffer, so its IPC write is still pending when the turn ends.
  fs.writeFileSync(f.bins.codex, `#!${process.execPath}\nimport readline from 'node:readline';
if(process.argv.includes('--version')){console.log('long-answer-fixture 1');process.exit(0);}
const send=value=>console.log(JSON.stringify(value));
readline.createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);
if(message.method==='initialize')send({id:message.id,result:{}});
if(message.method==='model/list')send({id:message.id,result:{data:[]}});
if(message.method==='thread/start')send({id:message.id,result:{thread:{id:'long-thread'},model:'actual-model'}});
if(message.method==='turn/start'){send({id:message.id,result:{turn:{id:'long-turn'}}});send({method:'item/completed',params:{threadId:'long-thread',item:{id:'answer',type:'agentMessage',text:'x'.repeat(262144)}}});send({method:'turn/completed',params:{threadId:'long-thread',turn:{status:'completed'}}});}
});\n`);
  const broker = f.broker(); const c = broker.get(broker.create().id);
  const { runId } = broker.start(c, { text: 'Write a long answer', provider: 'codex', transport: 'app-server' });
  await broker.running.done;
  assert.equal(c.status, 'complete');
  assert.equal(c.messages.find(m => m.runId === runId && m.role === 'assistant')?.text.length, 262144);
});

test('the CLI worker forwards all provider output to a slow reader before it exits', async t => {
  const f = setup(t), bin = path.join(f.root, 'large-output.mjs');
  fs.writeFileSync(bin, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(1048576));\n`, { mode: 0o700 });
  const worker = fork(fileURLToPath(new URL('../provider-worker.mjs', import.meta.url)), [], { silent: true });
  worker.send({ type: 'start', config: { transport: 'cli', bin, args: [], workspace: f.workspace, prompt: '' } });
  // A busy broker reads slowly, so output is still queued in the worker when the CLI exits.
  let received = 0;
  worker.stdout.on('data', chunk => { received += chunk.length; worker.stdout.pause(); setTimeout(() => worker.stdout.resume(), 5); });
  await once(worker, 'close');
  assert.equal(received, 1048576);
});

test('Claude native rate-limit metadata distinguishes warnings from quota rejection', t => {
  const f = setup(t); const broker = f.broker(); const c = broker.get(broker.create().id);
  const run = { id: 'rate-test', c, provider: 'claude', failed: false };
  broker.event(run, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.9 } });
  assert.equal(run.failed, false);
  broker.event(run, { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1234, rateLimitType: 'five_hour' } });
  assert.equal(run.failed, true); assert.equal(run.errorCategory, 'quota');
  const error = c.messages.find(m => m.role === 'error' && /usage limit reached/.test(m.text));
  assert.match(error.text, /5-hour window\. It resets /); assert.doesNotMatch(error.text, /[{}"]/, 'The notice is readable text, not raw provider JSON.');
});

test('fresh Codex CLI reconstruction retains non-Git opt-in and installed process guards', async t => {
  const f = setup(t); const broker = f.broker(); const c = broker.get(broker.create().id);
  broker.start(c, { text: 'Initial', provider: 'codex' }); await broker.running.done;
  broker.start(c, { text: 'Reconstruct', provider: 'codex', fresh: true }); await broker.running.done;
  const captures = fs.readFileSync(path.join(f.workspace, '.mock-captures.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(captures.at(-1).args.includes('resume'), false);
  assert.equal(captures.at(-1).args.includes('--skip-git-repo-check'), true);
});
test('invalid Codex JSON-RPC fails before later valid responses can hide dropped events', async t => {
  const f = setup(t); const executable = path.join(f.root, 'malformed.mjs');
  fs.writeFileSync(executable, `#!${process.execPath}\nimport readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);console.log('invalid-json-protocol');console.log(JSON.stringify({id:m.id,result:{}}));});\n`, { mode: 0o700 });
  const client = new CodexClient({ bin: executable, cwd: f.workspace });
  try { await assert.rejects(client.initialize(), /protocol/); } finally { client.close(); }
});
