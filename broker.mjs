import { fork, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { resolveBinary } from './resolve-binary.mjs';
import { fileURLToPath } from 'node:url';
import { prepareContext, emptyContext, validateContext } from './context.mjs';
import { classifyError, capabilities, accountStatus } from './providers.mjs';
import { workspaceBaseline } from './workspace-baseline.mjs';
import { AttachmentStore } from './attachments.mjs';

export const PROVIDERS = ['codex', 'claude'];
const MODES = ['edit', 'read'];
const clip = (text, max = 16000) => String(text ?? '').length > max
  ? `${String(text).slice(0, max)}\n[Output shortened; inspect project files for the full state.]`
  : String(text ?? '');

function checkSettings(provider, mode) {
  if (!PROVIDERS.includes(provider) || !MODES.includes(mode)) {
    throw Object.assign(new Error('Choose Codex or Claude and an edit or read mode.'), { status: 400 });
  }
}

function savedWorkspace(directory) {
  try { return fs.realpathSync(directory); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code) && path.isAbsolute(directory)) return path.resolve(directory);
    throw error;
  }
}

export function commandFor(provider, { mode, sessionId, bin, workspace, workspaces = [], effort }) {
  checkSettings(provider, mode);
  if (provider === 'codex') {
    const args = ['--ask-for-approval', 'never', '--sandbox', mode === 'edit' ? 'workspace-write' : 'read-only'];
    if (effort) args.push('-c', 'model_reasoning_effort=' + effort);
    // --add-dir grants writes, so never use it with a read-only invocation.
    if (mode === 'edit') for (const directory of workspaces.filter(directory => directory !== workspace)) args.push('--add-dir', directory);
    args.push('exec');
    if (sessionId) args.push('resume', sessionId);
    args.push('--json', '-');
    return { bin: bin || 'codex', args };
  }
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', mode === 'edit' ? 'acceptEdits' : 'plan',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowedTools', 'mcp__*'];
  // Restrict built-in tools in read mode; a previous session's allowed write tools cannot carry over.
  if (mode === 'read') args.push('--tools', 'Read,Glob,Grep');
  if (effort) args.push('--effort', effort);
  for (const directory of workspaces.filter(directory => directory !== workspace)) args.push('--add-dir', directory);
  if (sessionId) args.push('--resume', sessionId);
  return { bin: bin || 'claude', args };
}

export class Broker extends EventEmitter {
  constructor({ workspace, workspaces = [], workspaceFolders = [], dataDir, bins = {}, acquireMutation = () => ({ release() {}, setProcess() {} }) }) {
    super();
    this.workspace = savedWorkspace(workspace);
    this.workspaces = [...new Set([this.workspace, ...workspaces.map(savedWorkspace), ...workspaceFolders.map(folder => savedWorkspace(folder.path))])];
    this.workspaceFolders = this.workspaces.map(directory => {
      const configured = workspaceFolders.find(folder => savedWorkspace(folder.path) === directory);
      return { id: configured?.id || createHash('sha256').update(directory).digest('hex').slice(0, 16), name: configured?.name || path.basename(directory), ...(configured?.displayName ? { displayName: configured.displayName } : {}), path: directory };
    });
    this.workspaceSignature = createHash('sha256').update(JSON.stringify({ primary: this.workspace, roots: [...this.workspaces].sort() })).digest('hex');
    this.dataDir = dataDir;
    this.attachments = new AttachmentStore(dataDir);
    this.configuredBins = { ...bins };
    this.acquireMutation = acquireMutation;
    this.bins = Object.fromEntries(PROVIDERS.map(provider => [provider, resolveBinary(provider, { override: bins[provider] })]));
    this.conversations = new Map();
    this.running = null;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    for (const filename of fs.readdirSync(dataDir).filter(name => /^[\da-f-]{36}\.jsonl$/.test(name))) {
      const id = filename.slice(0, -6);
      const conversation = this.empty(id);
      const source = fs.readFileSync(path.join(dataDir, filename), 'utf8');
      const lines = source.split('\n');
      // A crash may tear the last append. Repair only that unterminated record.
      if (lines.at(-1)) {
        let valid = true;
        try { JSON.parse(lines.at(-1)); } catch { valid = false; }
        if (valid) { fs.appendFileSync(path.join(dataDir, filename), '\n'); lines.push(''); }
        else { lines.pop(); fs.writeFileSync(path.join(dataDir, filename), `${lines.join('\n')}\n`, { mode: 0o600 }); }
      }
      for (const line of lines.filter(Boolean)) this.apply(conversation, JSON.parse(line));
      if (!conversation.createdAt) throw new Error(`Invalid conversation journal: ${filename}`);
      this.conversations.set(id, conversation);
      if (conversation.activeRun) {
        if (conversation.activeRun.pid && process.platform !== 'win32') {
          try {
            process.kill(-conversation.activeRun.pid, 0);
            throw new Error(`An assistant from the previous run may still be active (process group ${conversation.activeRun.pid}). Stop that process group before restarting Throughline.`);
          } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        for (const message of conversation.messages.filter(m => m.runId === conversation.activeRun.id && m.role === 'assistant')) {
          this.record(conversation, { type: 'message_update', id: message.id, update: { status: 'incomplete' } });
        }
        this.message(conversation, 'error', 'The previous run was interrupted. Its saved output is available; inspect project changes before continuing.', conversation.provider);
        this.record(conversation, { type: 'run_end', status: 'interrupted', errorCategory: 'interrupted' });
      }
    }
  }

  empty(id) {
    return { id, title: 'New conversation', provider: 'codex', mode: 'edit', status: 'idle', messages: [],
      sessions: {}, models: {}, efforts: {}, effort: null, imports: {}, transports: {}, requests: {}, context: emptyContext(), model: null, transport: 'auto', settingsRevision: 0, lastRun: null, records: 0, activeRun: null, createdAt: null, updatedAt: null };
  }

  apply(c, record) {
    c.records = record.seq;
    c.updatedAt = record.at;
    if (record.type === 'created') Object.assign(c, { createdAt: record.at, title: record.title });
    if (record.type === 'settings') { Object.assign(c, { provider: record.provider, mode: record.mode, model: record.model ?? null, transport: record.transport || c.transport, settingsRevision: record.seq }); c.models[record.provider] = record.model ?? null; c.transports[record.provider] = record.transport || c.transport; }
    if (record.type === 'context') c.context = record.context;
    if (['settings', 'submission'].includes(record.type)) {
      c.effort = record.effort ?? null;
      c.efforts[record.provider] ||= {};
      c.efforts[record.provider][record.model || 'default'] = c.effort;
    }
    if (record.type === 'import') {
      for (const importId of record.importIds || [record.importId]) c.imports[importId] = true;
      for (const message of record.messages) {
        const previous = c.messages.find(item => item.id === message.id && item.importSource === message.importSource);
        if (previous) Object.assign(previous, message, { seq: record.seq, imported: true });
        else c.messages.push({ ...message, seq: record.seq, imported: true });
      }
    }
    if (record.type === 'message_delta') { const message = c.messages.find(m => m.id === record.id); if (!message) throw new Error('Message delta has no original message.'); message.text += record.text; message.seq = record.seq; if (record.status) message.status = record.status; }
    if (record.type === 'run_metadata') { if (c.activeRun) Object.assign(c.activeRun, record.metadata); }
    if (record.type === 'submission') {
      if (record.resetSession) delete c.sessions[record.provider];
      Object.assign(c, { provider: record.provider, mode: record.mode, model: record.model, transport: record.transport, settingsRevision: record.seq });
      c.models[record.provider] = record.model; c.transports[record.provider] = record.transport;
      if (record.title) c.title = record.title;
      c.messages.push({ ...record.message, seq: record.seq });
      c.requests[record.requestId] = { runId: record.id, requestId: record.requestId, fingerprint: record.fingerprint };
      c.activeRun = { id: record.id, provider: record.provider, model: record.model, transport: record.effectiveTransport || record.transport, baseline: record.baseline, context: record.context, effort: record.effort ?? null, phase: 'starting', lastEventAt: record.at, toolCount: 0, startedAt: record.at }; c.status = 'running';
    }
    if (record.type === 'title') c.title = record.title;
    if (record.type === 'message') c.messages.push({ ...record.message, seq: record.seq });
    if (record.type === 'message_update') {
      const message = c.messages.find(m => m.id === record.id);
      if (!message) throw new Error('Conversation contains an update without its original message.');
      Object.assign(message, record.update, { seq: record.seq });
    }
    if (record.type === 'session') c.sessions[record.provider] = {
      id: record.id, cursor: c.sessions[record.provider]?.id === record.id ? c.sessions[record.provider].cursor : 0,
      workspaceSignature: record.workspaceSignature,
    };
    if (record.type === 'checkpoint' && c.sessions[record.provider]) c.sessions[record.provider].cursor = record.seq;
    if (record.type === 'run_start') {
      c.activeRun = { id: record.id, provider: record.provider, startedAt: record.at };
      c.status = 'running';
    }
    if (record.type === 'run_process' && c.activeRun) c.activeRun.pid = record.pid;
    if (record.type === 'run_end') { c.lastRun = { ...c.activeRun, status: record.status, errorCategory: record.errorCategory || null, endedAt: record.at }; c.activeRun = null; c.status = record.status; }
  }

  record(c, value) {
    const record = { ...value, seq: c.records + 1, at: new Date().toISOString() };
    const fd = fs.openSync(path.join(this.dataDir, `${c.id}.jsonl`), 'a', 0o600);
    try { const bytes = Buffer.from(`${JSON.stringify(record)}\n`); let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(fd, bytes, offset, bytes.length - offset); if (!count) throw new Error('Journal write made no progress.'); offset += count; } fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.apply(c, record);
    this.emit('update', { conversationId: c.id });
    return record;
  }

  message(c, role, text, provider, id = randomUUID(), status) {
    const existing = c.messages.find(m => m.id === id);
    if (existing && text.startsWith(existing.text) && text !== existing.text) this.record(c, { type: 'message_delta', id, text: text.slice(existing.text.length), ...(status ? { status } : {}) });
    else if (existing && (text !== existing.text || (status && status !== existing.status))) this.record(c, { type: 'message_update', id, update: { ...(text !== existing.text ? { text } : {}), ...(status ? { status } : {}) } });
    else if (existing) return id;
    else this.record(c, { type: 'message', message: { id, role, text, provider, status,
      createdAt: new Date().toISOString(), runId: c.activeRun?.id, model: c.activeRun?.effectiveModel || c.activeRun?.model || null, effort: c.activeRun?.effectiveEffort || c.activeRun?.effort || null } });
    return id;
  }

  get(id) {
    const conversation = this.conversations.get(id);
    if (!conversation) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
    return conversation;
  }

  view(c) {
    const { sessions, requests, records, imports, ...visible } = c;
    return { ...visible, pendingApprovals: this.running?.c.id === c.id ? [...this.running.approvals.values()] : [], messages: c.messages.map(({ seq, ...m }) => m) };
  }

  list() {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, provider, mode, status, updatedAt }) => ({ id, title, provider, mode, status, updatedAt }));
  }

  create() {
    const c = this.empty(randomUUID());
    this.conversations.set(c.id, c);
    this.record(c, { type: 'created', title: 'New conversation' });
    return this.view(c);
  }

  settings(c, { provider = c.provider, mode = c.mode, model = provider === c.provider ? c.model : c.models[provider] || null, transport = provider === c.provider ? c.transport || 'auto' : c.transports[provider] || 'auto', effort = c.efforts[provider]?.[model || 'default'] ?? null }) {
    checkSettings(provider, mode);
    this.validateSelection(model, transport, effort);
    if (c.activeRun) throw Object.assign(new Error('Stop the current run before switching assistants.'), { status: 409 });
    this.record(c, { type: 'settings', provider, mode, model, transport, effort });
    return this.view(c);
  }

  validateSelection(model, transport, effort = null) {
    if (model !== null && model !== undefined && (typeof model !== 'string' || model.length > 200 || !model.trim())) throw Object.assign(new Error('Enter a model identifier of at most 200 characters.'), { status: 400 });
    if (effort !== null && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) throw Object.assign(new Error('Choose a supported reasoning effort or provider default.'), { status: 400 });
    if (!['auto', 'cli', 'app-server', 'sdk'].includes(transport)) throw Object.assign(new Error('Choose a supported provider transport.'), { status: 400 });
  }

  importTranscript(c, preview) { return this.importTranscripts(c, [preview]); }
  // Imports one or more reviewed native conversations as a single journal record, interleaved by original time.
  importTranscripts(c, previews) {
    if (c.activeRun || this.running) throw Object.assign(new Error('Stop the current run before importing a conversation.'), { status: 409 });
    const pending = previews.map(preview => ({ preview, importId: `${preview.provider}:${preview.sessionId}:${preview.digest}` })).filter(({ importId }) => !c.imports[importId]);
    if (!pending.length) return { imported: 0, updated: 0, duplicate: true, conversationId: c.id };
    const known = new Map(c.messages.filter(m => m.importSource).map(m => [m.importSource, m]));
    // A message without a timestamp keeps its place after the previous timed message of the same conversation.
    const rows = pending.flatMap(({ preview }, source) => { let time = 0; return preview.messages.map((message, index) => { const at = Date.parse(message.timestamp); if (Number.isFinite(at)) time = at; return { preview, message, time, source, index }; }); });
    rows.sort((first, second) => first.time - second.time || first.source - second.source || first.index - second.index);
    const messages = rows.map(({ preview, message: { timestamp, ...message } }) => {
      const importSource = `${preview.provider}:${preview.sessionId}:${message.sourceId}`, previous = known.get(importSource);
      return { ...message, provider: preview.provider === 'file' ? message.provider : preview.provider, id: previous?.id || randomUUID(), createdAt: previous?.createdAt || (Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : new Date().toISOString()), importSource };
    }).filter(message => !known.has(message.importSource) || known.get(message.importSource).text !== message.text);
    const updated = messages.filter(message => known.has(message.importSource)).length;
    this.record(c, { type: 'import', importId: pending[0].importId, importIds: pending.map(row => row.importId), messages });
    return { imported: messages.length - updated, updated, duplicate: !messages.length, conversationId: c.id };
  }

  touch(run, phase) {
    if (!run.c.activeRun) return;
    const now = new Date().toISOString();
    Object.assign(run.c.activeRun, { lastEventAt: now, ...(phase ? { phase } : {}) });
    run.lastPhase = phase || run.lastPhase;
    if (!run.lastProgressNotice || Date.now() - run.lastProgressNotice > 750) { run.lastProgressNotice = Date.now(); this.emit('update', { conversationId: run.c.id }); }
  }

  updateContext(c, input) { const context = validateContext(input, c.context); this.record(c, { type: 'context', context }); return this.view(c); }

  approve(runId, approvalId, allow) {
    const run = this.running;
    if (!run || run.id !== runId || !run.approvals.has(approvalId)) throw Object.assign(new Error('This approval is no longer pending.'), { status: 409 });
    if (typeof allow !== 'boolean') throw Object.assign(new Error('Choose allow or deny.'), { status: 400 });
    run.approvals.delete(approvalId);
    run.child?.send({ type: 'approval-result', id: approvalId, allow });
    this.message(run.c, 'activity', `Approval ${allow ? 'allowed' : 'denied'} by the user.`, run.provider);
    return { resolved: true };
  }

  status() {
    if (!this.providerStatus || Date.now() - this.providerStatusCheckedAt >= 10000) {
      this.providerStatus = Object.fromEntries(PROVIDERS.map(provider => {
        const bin = resolveBinary(provider, { override: this.configuredBins[provider] });
        this.bins[provider] = bin;
        const result = bin ? spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 4000, shell: false }) : null;
        return [provider, { available: result?.status === 0, version: clip(result?.stdout?.trim(), 200), path: bin, installed: result?.status === 0, authenticated: 'unknown', billingSource: 'unknown', authMode: 'unknown', usage: 'unknown', capabilities: capabilities(provider, this.configuredBins[provider] ? 'cli' : 'auto') }];
      }));
      this.providerStatusCheckedAt = Date.now();
    }
    return { workspace: this.workspace, workspaces: this.workspaces, workspaceFolders: this.workspaceFolders, providers: this.providerStatus, runningConversationId: this.running?.c.id || null, pendingApprovals: this.running ? [...this.running.approvals.values()] : [] };
  }

  prompt(c, text, fresh = false) { return prepareContext(c, text, { workspace: this.workspace, workspaceFolders: this.workspaceFolders, fresh: fresh || c.sessions[c.provider]?.workspaceSignature !== this.workspaceSignature }).prompt; }

  start(c, { text, attachments: attachmentIds = [], provider = c.provider, mode = c.mode, fresh = false, model = provider === c.provider ? c.model : c.models[provider] || null, transport = provider === c.provider ? c.transport || 'auto' : c.transports[provider] || 'auto', requestId = randomUUID(), billingConfirmed = false, effort = c.efforts[provider]?.[model || 'default'] ?? null }) {
    checkSettings(provider, mode);
    this.validateSelection(model, transport, effort);
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw Object.assign(new Error('Enter a message between 1 and 100,000 characters.'), { status: 400 });
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) throw Object.assign(new Error('Invalid request ID.'), { status: 400 });
    const attachments = this.attachments.select(attachmentIds);
    text = text.trim(); model = model || null;
    const fingerprint = createHash('sha256').update(JSON.stringify({ text, ...(attachments.length ? { attachments: attachmentIds } : {}), provider, mode, fresh, model, ...(effort ? { effort } : {}), transport: transport === 'auto' ? this.configuredBins[provider] ? 'cli' : provider === 'codex' ? 'app-server' : 'sdk' : transport })).digest('hex');
    const accepted = c.requests[requestId];
    if (accepted) { if (accepted.fingerprint !== fingerprint) throw Object.assign(new Error('This request ID was already used for another message.'), { status: 409 }); return { runId: accepted.runId, requestId, duplicate: true }; }
    if (this.running) throw Object.assign(new Error('An assistant is already working in this workspace. Stop it before starting another run.'), { status: 409 });
    for (const directory of this.workspaces) {
      let available = false;
      try { available = fs.statSync(directory).isDirectory(); } catch {}
      if (!available) throw Object.assign(new Error(`Workspace folder is unavailable: ${directory}. Reconnect it or remove it from this project before starting an assistant.`), { status: 409 });
    }
    const bin = resolveBinary(provider, { override: this.configuredBins[provider] });
    if (!bin) throw Object.assign(new Error(`${provider === 'codex' ? 'Codex' : 'Claude'} CLI could not be found. Install it or set AI_RELAY_${provider.toUpperCase()}_BIN to its executable path, then retry.`), { status: 503, category: 'installation' });
    const actualTransport = transport === 'auto' ? this.configuredBins[provider] ? 'cli' : provider === 'codex' ? 'app-server' : 'sdk' : transport;
    if ((provider === 'codex' && actualTransport === 'sdk') || (provider === 'claude' && actualTransport === 'app-server')) throw Object.assign(new Error('This transport does not support the selected provider.'), { status: 400 });
    // A native session may retain tool permissions for folders since removed.
    // Reconstruct from the canonical journal whenever membership changes.
    const resetSession = Boolean(c.sessions[provider] && c.sessions[provider].workspaceSignature !== this.workspaceSignature);
    const effectiveFresh = fresh || resetSession;
    const sessionId = effectiveFresh ? null : c.sessions[provider]?.id;
    const prepared = prepareContext(c, text, { workspace: this.workspace, workspaceFolders: this.workspaceFolders, fresh: effectiveFresh, provider, mode, attachments, readAttachment: id => this.attachments.read(id) });
    if (actualTransport === 'cli' && prepared.images.length) throw Object.assign(new Error('Image attachments require the native Codex or Claude connection. Switch the transport from CLI, or remove the images.'), { status: 400 });
    const images = prepared.images.map(file => this.attachments.imageInput(file.id));
    const lease = this.acquireMutation(`provider:${provider}`);
    let baseline;
    try { baseline = workspaceBaseline(this.workspace, this.workspaceFolders); } catch (error) { lease.release(); throw error; }
    const runId = randomUUID();
    const run = { id: runId, c, provider, child: null, terminalSuccess: false, failed: false, stopped: false,
      stderr: '', tools: new Map(), approvals: new Map(), currentClaudeMessage: null, killTimer: null, done: null, lease, errorCategory: null, workspaceSignature: this.workspaceSignature };
    let finish;
    run.done = new Promise(resolve => { finish = resolve; });
    try {
      this.record(c, { type: 'submission', id: runId, requestId, fingerprint, provider, mode, model, effort, transport, effectiveTransport: actualTransport, baseline, context: prepared.metadata, resetSession, workspaceSignature: this.workspaceSignature,
        ...(c.messages.every(m => m.role !== 'user') ? { title: text.slice(0, 64) } : {}),
        message: { id: randomUUID(), role: 'user', text, ...(attachments.length ? { attachments } : {}), provider, createdAt: new Date().toISOString(), runId } });
    } catch (error) { lease.release(); throw error; }
    this.running = run; this.bins[provider] = bin;
    let finished = false;
    const complete = (code, signal, error) => {
      if (finished) return; finished = true; clearTimeout(run.killTimer);
      let success = code === 0 && run.terminalSuccess && !run.failed && !run.stopped && !error;
      try {
        if (run.child?.pid) this.signal(run, 'SIGKILL');
        run.approvals.clear();
        if (!success) {
          const detail = run.stopped ? 'Stopped. Files already changed by this run remain in the workspace.' : error?.message || run.stderr.trim() || `The assistant ended without completing the turn (exit ${code ?? signal ?? 'unknown'}).`;
          run.errorCategory ||= run.stopped ? 'interrupted' : classifyError(error || detail);
          this.message(c, 'error', clip(detail) + (run.stopped ? '' : '\nYour conversation is saved. Select the other assistant and continue, or retry after resolving the error.'), provider);
        }
        for (const message of c.messages.filter(m => m.runId === runId && m.role === 'assistant')) this.record(c, { type: 'message_update', id: message.id, update: { status: success ? 'complete' : 'incomplete' } });
        this.record(c, { type: 'run_metadata', metadata: { elapsedMs: Date.now() - Date.parse(c.activeRun.startedAt), phase: success ? 'complete' : 'stopped', lastEventAt: c.activeRun.lastEventAt } });
        this.record(c, { type: 'run_end', status: run.stopped ? 'interrupted' : success ? 'complete' : 'incomplete', errorCategory: run.errorCategory });
        if (success && c.sessions[provider]) this.record(c, { type: 'checkpoint', provider });
      } catch (persistError) { success = false; run.persistenceError = persistError.message; }
      finally { try { lease.release(); } catch (releaseError) { success = false; run.persistenceError ||= releaseError.message; } finally { this.running = null; this.emit('update', { conversationId: c.id }); finish({ success, error: run.persistenceError }); } }
    };
    const launch = async () => {
      try {
        if (!this.configuredBins[provider]) {
          const account = await accountStatus(provider, { bin, workspace: this.workspace });
          this.record(c, { type: 'run_metadata', metadata: { account: { authenticated: account.authenticated, authMode: account.authMode, billingSource: account.billingSource } } });
          if (account.authenticated === false) throw Object.assign(new Error('Sign in through the provider’s supported authentication flow before running.'), { category: 'authentication' });
          if (account.billingSource !== 'subscription' && !billingConfirmed) throw Object.assign(new Error(`Billing source is ${account.billingSource}. Explicitly confirm this provider run before it may consume usage.`), { category: 'permission' });
        }
        if (run.stopped) return complete(null, null, new Error('Run stopped.'));
        const command = commandFor(provider, { mode, sessionId, bin, workspace: this.workspace, workspaces: this.workspaces, effort });
        if (provider === 'codex') {
          command.args.unshift('-c', 'features.hooks=false', '-c', 'notify=[]');
          if (model) command.args.unshift('--model', model);
          if (!baseline.git && !sessionId) command.args.splice(command.args.indexOf('exec') + 1, 0, '--skip-git-repo-check');
        } else {
          command.args.push('--setting-sources', '', '--settings', '{"disableAllHooks":true}');
          command.args.push('--model', model || 'default');
        }
        // The worker cannot launch a provider until its PID and mutation lease are durable.
        run.child = fork(fileURLToPath(new URL('./provider-worker.mjs', import.meta.url)), [], { cwd: this.workspace, silent: true, detached: process.platform !== 'win32', execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        run.child.on('error', error => { run.spawnError = error; });
        let buffer = '';
        const consume = line => { if (!line.trim()) return; try { this.event(run, JSON.parse(line)); } catch (error) { run.failed = true; run.errorCategory = 'protocol'; run.stderr = clip(`${run.stderr}\n${error.message}`); } };
        run.child.stdout.setEncoding('utf8'); run.child.stderr.setEncoding('utf8');
        run.child.stdout.on('data', chunk => {
          buffer += chunk;
          if (buffer.length > 8 * 1024 * 1024) { run.failed = true; run.errorCategory = 'protocol'; run.stderr = 'Oversized provider protocol event.'; this.stop(c.id); return; }
          let newline; while ((newline = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
        });
        run.child.stderr.on('data', chunk => { run.stderr = clip(run.stderr + chunk); });
        run.child.on('message', message => {
          try {
            if (message.type === 'event') this.event(run, message.event);
            if (message.type === 'metadata') this.record(c, { type: 'run_metadata', metadata: message.metadata });
            if (message.type === 'failure') { run.failed = true; run.errorCategory = message.category; run.stderr = clip(run.stderr + '\n' + message.message); }
            if (message.type === 'approval') { const approval = { ...message.request, runId, provider }; run.approvals.set(approval.id, approval); this.emit('update', { conversationId: c.id }); }
          } catch (error) { run.failed = true; run.errorCategory = classifyError(error); run.stderr = error.message; this.stop(c.id); }
        });
        run.child.on('close', (code, signal) => { if (buffer.trim()) consume(buffer); complete(code, signal, run.spawnError); });
        this.record(c, { type: 'run_process', pid: run.child.pid });
        lease.setProcess(run.child.pid);
        run.child.send({ type: 'start', config: { bin, args: command.args, workspace: this.workspace, workspaces: this.workspaces, workspaceFolders: this.workspaceFolders, prompt: prepared.prompt, images, transport: actualTransport, provider, mode, model, effort, sessionId } });
      } catch (error) { run.errorCategory = error.category || classifyError(error); complete(null, null, error); }
    };
    launch();
    return { runId, requestId };
  }

  event(run, event) {
    const phase = event.type === 'thread.started' || event.type === 'system' && event.subtype === 'init' ? 'working' : event.item?.type === 'reasoning' ? 'reasoning' : event.type === 'relay.progress' ? event.phase : event.type === 'relay.delta' ? 'responding' : event.type === 'stream_event' && event.event?.delta?.type === 'text_delta' ? 'responding' : event.item?.type === 'command_execution' || event.item?.type === 'file_change' ? (event.type === 'item.started' ? 'tool' : 'working') : event.type === 'assistant' && event.message?.content?.some(block => block.type === 'tool_use') ? 'tool' : null;
    const toolIds = [...(event.item && ['command_execution', 'file_change', 'mcp_tool_call', 'web_search'].includes(event.item.type) && event.item.id ? [event.item.id] : []), ...(event.type === 'assistant' ? (event.message?.content || []).filter(block => block.type === 'tool_use').map(block => block.id) : [])];
    run.seenTools ||= new Set();
    for (const id of toolIds) if (!run.seenTools.has(id)) { run.seenTools.add(id); if (run.c.activeRun) run.c.activeRun.toolCount = run.seenTools.size; }
    this.touch(run, phase);
    if (event.type === 'relay.progress') return;
    const { c, provider } = run;
    if (!event || typeof event !== 'object') throw new Error('Invalid provider protocol event.');
    if (event.type === 'relay.delta') { const id = `${run.id}:${event.id}`; const existing = c.messages.find(m => m.id === id); this.message(c, 'assistant', (existing?.text || '') + event.text, provider, id, 'streaming'); return; }
    if (provider === 'codex') {
      if (event.type === 'thread.started' && event.thread_id) this.record(c, { type: 'session', provider, id: event.thread_id, workspaceSignature: run.workspaceSignature || this.workspaceSignature });
      if (event.type === 'turn.completed') run.terminalSuccess = true;
      if (event.type === 'error') this.message(c, 'activity', clip(`Codex diagnostic: ${event.message || JSON.stringify(event)}`), provider);
      if (event.type === 'turn.failed') {
        run.failed = true; run.errorCategory = classifyError(event.error || event.message);
        this.message(c, 'error', clip(event.message || event.error?.message || JSON.stringify(event.error || event)), provider);
      }
      const item = event.item;
      if (!item || !['item.started', 'item.updated', 'item.completed'].includes(event.type)) return;
      const id = `${run.id}:${item.id || randomUUID()}`;
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        this.message(c, 'assistant', item.text, provider, id, event.type === 'item.completed' ? 'complete' : 'streaming');
      }
      if (item.type === 'command_execution') this.message(c, 'activity', clip(`$ ${item.command}\n${item.aggregated_output || ''}`), provider, id);
      if (item.type === 'file_change') this.message(c, 'activity', `File changes: ${JSON.stringify(item.changes || [])}`, provider, id);
      if (['mcp_tool_call', 'web_search'].includes(item.type)) this.message(c, 'activity', clip(`${item.type}: ${item.tool || item.query || ''}\n${JSON.stringify(item.result || item.arguments || '')}`), provider, id);
      return;
    }
    if (event.type === 'rate_limit_event') {
      // Kept apart from `usage`, which holds the run's token counts.
      this.record(c, { type: 'run_metadata', metadata: { rateLimit: event.rate_limit_info } });
      if (event.rate_limit_info?.status === 'rejected') {
        const info = event.rate_limit_info, period = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet', overage: 'extra usage' }[info.rateLimitType];
        const resets = Number.isFinite(info.resetsAt) ? new Date(info.resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null;
        run.failed = true; run.errorCategory = 'quota';
        this.message(c, 'error', `Claude usage limit reached${period ? ` for the ${period} window` : ''}.${resets ? ` It resets ${resets}.` : ''} Switch to Codex or continue after the reset.`, provider);
      }
    }
    if (event.type === 'assistant' && event.error) { run.failed = true; run.errorCategory = classifyError(event.error + ' ' + JSON.stringify(event.message?.content || [])); }
    if (event.session_id && c.sessions.claude?.id !== event.session_id) this.record(c, { type: 'session', provider, id: event.session_id, workspaceSignature: run.workspaceSignature || this.workspaceSignature });
    if (event.type === 'stream_event') {
      const stream = event.event;
      if (stream?.type === 'message_start') run.currentClaudeMessage = stream.message?.id || randomUUID();
      if (stream?.type === 'content_block_delta' && stream.delta?.type === 'text_delta') {
        const id = `${run.id}:${run.currentClaudeMessage || 'response'}`;
        const existing = c.messages.find(m => m.id === id);
        this.message(c, 'assistant', (existing?.text || '') + stream.delta.text, provider, id, 'streaming');
      }
    }
    if (event.type === 'assistant') {
      const content = event.message?.content || [];
      const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      const id = `${run.id}:${event.message?.id || run.currentClaudeMessage || 'response'}`;
      if (text) this.message(c, 'assistant', text, provider, id, 'complete');
      for (const tool of content.filter(block => block.type === 'tool_use')) {
        run.tools.set(tool.id, tool.name);
        this.message(c, 'activity', clip(`${tool.name}\n${JSON.stringify(tool.input || {})}`), provider, `${run.id}:tool:${tool.id}`);
      }
    }
    if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const tool of event.message.content.filter(block => block.type === 'tool_result')) {
        const id = `${run.id}:tool:${tool.tool_use_id}`;
        const existing = c.messages.find(m => m.id === id);
        const content = typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content || []);
        this.message(c, 'activity', clip(`${existing?.text || run.tools.get(tool.tool_use_id) || 'Tool result'}\n${content}`), provider, id);
      }
    }
    if (event.type === 'system' && event.subtype === 'init' && event.model) this.record(c, { type: 'run_metadata', metadata: { effectiveModel: event.model } });
    if (event.type === 'result') {
      run.terminalSuccess = event.subtype === 'success' && !event.is_error;
      if (!run.terminalSuccess) {
        run.failed = true; run.errorCategory = classifyError(event.result || event.errors?.join(' '));
        this.message(c, 'error', clip(event.result || event.errors?.join('\n') || event.subtype || 'Claude could not complete this turn.'), provider);
      } else if (event.result && !c.messages.some(m => m.runId === run.id && m.role === 'assistant')) {
        this.message(c, 'assistant', event.result, provider, `${run.id}:response`, 'complete');
      }
      if (event.permission_denials?.length) {
        run.failed = true; run.errorCategory = 'permission';
        this.message(c, 'error', 'Claude requested a tool that needs approval in its native terminal. Some work may be incomplete.\n' + clip(JSON.stringify(event.permission_denials)), provider);
      }
    }
  }

  signal(run, signal) {
    try {
      if (process.platform !== 'win32') process.kill(-run.child.pid, signal);
      else run.child.kill(signal);
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }

  stop(id) {
    if (!this.running || this.running.c.id !== id) return { stopped: false };
    const run = this.running;
    if (run.stopped) return { stopped: true };
    run.stopped = true;
    run.approvals.clear();
    if (run.child?.connected) run.child.send({ type: 'cancel' });
    if (run.child?.pid) {
      this.signal(run, 'SIGTERM');
      run.killTimer = setTimeout(() => this.signal(run, 'SIGKILL'), 3000);
      run.killTimer.unref();
    }
    return { stopped: true };
  }

  async close() {
    if (this.running) {
      const run = this.running;
      this.stop(run.c.id);
      await run.done;
    }
  }
}
