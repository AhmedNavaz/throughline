import { geminiSetup, isAgy, agyUnsupported } from './gemini.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import os from 'node:os';
import { probeCli } from './cli-probe.mjs';
import { resolveBinary, withBinaryPath } from './resolve-binary.mjs';
import { localEndpoint, verifyLocalModel } from './local-models.mjs';

export function classifyError(error) {
  const text = typeof error === 'string' ? error : `${error?.code || ''} ${error?.message || ''} ${JSON.stringify(error?.data || error || {})}`;
  if (/usage.?limit|rate.?limit|hit.*limit|limit.*reset|out of.*usage|quota|429|credits?.*(?:exhaust|deplet)|UsageLimitExceeded/i.test(text)) return 'quota';
  if (/unauth|not.?logged|login|sign.?in|authenticat|401|invalid.?api.?key/i.test(text)) return 'authentication';
  if (/ENOENT|not found|not installed|could not be found|Cannot find package/i.test(text)) return 'installation';
  if (/permission|approv|denied|sandbox|EACCES|EPERM/i.test(text)) return 'permission';
  if (/abort|cancel|stopped|interrupt/i.test(text)) return 'interrupted';
  if (/protocol|JSON|without complet|oversized|invalid.*event|unexpected.*event/i.test(text)) return 'protocol';
  return 'execution';
}
export function capabilities(provider, transport = 'auto') {
  const native = transport !== 'cli';
  return { approvals: native, nativeResume: provider !== 'gemini', models: native,
    readOnly: provider === 'codex' ? 'native-sandbox' : 'restricted-tools',
    hooks: 'User/project hooks disabled for this invocation; administrator policy may remain active.',
    readOnlyLimit: 'Access settings govern provider tools. They are not a host-wide guarantee against administrator hooks or external processes.' };
}

export function localCodexConfig(local) {
  return { model_provider: 'throughline_ollama', model: local.model,
    'model_providers.throughline_ollama': { name: 'Ollama (local)', base_url: localEndpoint(local.endpoint) + '/v1', wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, request_max_retries: 0, stream_max_retries: 0, capabilities: { external_web_access: false, remote_compaction: 'unsupported' } },
    mcp_servers: {}, web_search: 'disabled', 'analytics.enabled': false, 'otel.exporter': 'none', 'otel.metrics_exporter': 'none', 'otel.trace_exporter': 'none',
    model_context_window: Math.min(local.contextWindow || 32768, 65536) };
}
const toml = value => typeof value === 'object' && value !== null ? '{' + Object.entries(value).map(([key, entry]) => JSON.stringify(key) + '=' + toml(entry)).join(',') + '}' : JSON.stringify(value);
export class CodexClient extends EventEmitter {
  constructor({ bin, cwd = os.homedir(), spawnImpl = spawn, local } = {}) {
    super();
    this.pending = new Map(); this.counter = 0; this.closed = false;
    const args = ['-c', 'features.hooks=false', '-c', 'notify=[]'];
    if (local) for (const [key, value] of Object.entries(localCodexConfig(local))) args.push('-c', key + '=' + toml(value));
    const env = withBinaryPath(bin, { ...process.env });
    if (local) for (const key of Object.keys(env)) if (/^(?:OPENAI|CODEX_API|OLLAMA|ANTHROPIC)_/.test(key)) delete env[key];
    this.child = spawnImpl(bin, [...args, 'app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, env });
    let diagnostic = '';
    this.child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-16000); });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && !message.method) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          if (message.error) pending.reject(Object.assign(new Error(message.error.message || 'Codex protocol error'), { data: message.error.data }));
          else pending.resolve(message.result);
        } else this.emit('message', message);
      } catch (error) {
        const failure = new Error(`Invalid Codex JSON-RPC protocol: ${error.message}`);
        for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(failure); }
        this.pending.clear(); this.emit('closed', failure); this.close();
      }
    });
    const end = error => {
      this.closed = true;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
      this.pending.clear(); this.emit('closed', error);
    };
    this.child.on('error', end);
    this.child.on('close', (code, signal) => end(new Error(diagnostic || `Codex app-server closed (${code ?? signal}).`)));
    this.child.stdin.on('error', () => {});
  }
  send(message) { if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`); }
  request(method, params = {}, timeout = 20000) {
    if (this.closed) return Promise.reject(new Error('Codex app-server is closed.'));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex protocol timed out: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async initialize() { await this.request('initialize', { clientInfo: { name: 'ai_relay', title: 'Throughline', version: '0.2.0' } }); this.send({ method: 'initialized', params: {} }); }
  close() { if (!this.closed) { this.child.stdin.end(); this.child.kill('SIGTERM'); } }
}

export async function runCodex(config, { event, approval, metadata, cancelled = () => false, clientFactory = options => new CodexClient(options), verifyLocal = verifyLocalModel }) {
  if (config.local) config.local = { ...config.local, ...await verifyLocal(config.local.model, config.local.digest, { endpoint: config.local.endpoint }) };
  const client = clientFactory({ bin: config.bin, cwd: config.workspace, ...(config.local ? { local: config.local } : {}) });
  let threadId, turnId, resolveEnd, rejectEnd;
  const ended = new Promise((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; });
  // Initialization failures may happen before awaiting the terminal promise.
  ended.catch(() => {});
  client.on('closed', rejectEnd);
  client.on('message', async message => {
    try {
      const p = message.params || {};
      if (message.id !== undefined && message.method) {
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
          const allow = config.mode === 'read' ? false : await approval({ id: String(message.id), kind: message.method, ...p });
          client.send({ id: message.id, result: { decision: allow ? 'accept' : 'decline' } });
        } else client.send({ id: message.id, error: { code: -32601, message: 'This interaction is not supported by Throughline; use the native client.' } });
        return;
      }
      if (p.threadId && threadId && p.threadId !== threadId) return;
      if (/reasoning.*(?:Delta|delta)|reasoning\//i.test(message.method)) event({ type: 'relay.progress', phase: 'reasoning' });
      if (message.method === 'item/commandExecution/outputDelta') event({ type: 'relay.progress', phase: 'tool' });
      if (message.method === 'thread/tokenUsage/updated') metadata({ usage: p.tokenUsage });
      if (message.method === 'item/agentMessage/delta') event({ type: 'relay.delta', id: p.itemId, text: p.delta });
      if (['item/started', 'item/completed'].includes(message.method)) {
        const item = p.item;
        if (item?.type === 'reasoning') event({ type: 'relay.progress', phase: 'reasoning' });
        if (item?.type === 'commandExecution' || item?.type === 'fileChange') event({ type: 'relay.progress', phase: message.method === 'item/started' ? 'tool' : 'working' });
        if (item?.type === 'agentMessage') event({ type: message.method === 'item/completed' ? 'item.completed' : 'item.started', item: { ...item, type: 'agent_message' } });
        if (item?.type === 'commandExecution') event({ type: message.method === 'item/completed' ? 'item.completed' : 'item.started', item: { ...item, type: 'command_execution', aggregated_output: item.aggregatedOutput || '' } });
        if (item?.type === 'fileChange') event({ type: message.method === 'item/completed' ? 'item.completed' : 'item.started', item: { ...item, type: 'file_change' } });
      }
      if (message.method === 'error') event(p.willRetry ? { type: 'error', message: p.error?.message || 'Retrying connection' } : { type: 'turn.failed', error: p.error });
      if (message.method === 'turn/completed') {
        if (p.turn?.status === 'completed') { event({ type: 'turn.completed' }); resolveEnd(); }
        else rejectEnd(new Error(p.turn?.error?.message || `Codex turn ${p.turn?.status || 'failed'}`));
      }
    } catch (error) { rejectEnd(error); }
  });
  try {
    await client.initialize();
    if (cancelled()) throw new Error('Run interrupted.');
    let selectedEffort = config.effort || null, selectedModel = config.model || null;
    if (!config.local && (!selectedEffort || !selectedModel)) {
      try {
        const { data } = await client.request('model/list', { limit: 100, includeHidden: false }, 2500);
        const model = data.find(row => selectedModel ? [row.id, row.model].includes(selectedModel) : row.isDefault);
        if (!selectedModel) selectedModel = model?.model || model?.id || null;
        if (!selectedEffort) selectedEffort = model?.defaultReasoningEffort || null;
      } catch { /* Older clients may not expose defaults; do not invent one. */ }
    }
    const roots = [...new Set([config.workspace, ...(config.workspaces || [])])];
    const options = { cwd: config.workspace, approvalPolicy: config.mode === 'read' ? 'never' : 'on-request', approvalsReviewer: 'user', sandbox: config.mode === 'read' ? 'read-only' : 'workspace-write', config: { 'sandbox_workspace_write.writable_roots': config.mode === 'read' ? [] : roots, ...(selectedEffort ? { model_reasoning_effort: selectedEffort } : {}), ...(config.local ? localCodexConfig(config.local) : {}) }, ...(selectedModel ? { model: selectedModel } : {}), ...(config.local ? { modelProvider: 'throughline_ollama', ephemeral: true } : {}) };
    if (config.local && (!selectedModel || config.sessionId)) throw new Error('Local runs require an explicit model and a fresh session.');
    const started = await client.request(config.sessionId ? 'thread/resume' : 'thread/start', { ...options, ...(config.sessionId ? { threadId: config.sessionId } : {}) });
    if (config.local && (started.thread.modelProvider !== 'throughline_ollama' || started.model && started.model !== selectedModel || started.thread.model && started.thread.model !== selectedModel)) throw new Error('The native client did not confirm the selected local provider and model. No task was sent.');
    threadId = started.thread.id;
    event({ type: 'thread.started', thread_id: threadId });
    metadata({ effectiveModel: started.model || started.thread.model || selectedModel || 'unknown', transport: 'app-server', effectiveEffort: started.reasoningEffort || selectedEffort || null, ...(config.local ? { connection: 'local', account: { authenticated: true, authMode: 'local', billingSource: 'local' } } : {}) });
    const turn = await client.request('turn/start', { threadId, ...(selectedEffort ? { effort: selectedEffort } : {}), input: [{ type: 'text', text: config.prompt }, ...(config.images || []).flatMap(image => [{ type: 'text', text: 'Attached image: ' + image.name }, { type: 'localImage', path: image.path }])], cwd: config.workspace,
      approvalPolicy: options.approvalPolicy, approvalsReviewer: 'user', sandboxPolicy: config.mode === 'read' ? { type: 'readOnly', networkAccess: false } : { type: 'workspaceWrite', writableRoots: roots, networkAccess: false }, ...(selectedModel ? { model: selectedModel } : {}) });
    turnId = turn.turn.id;
    const timer = setInterval(() => { if (cancelled()) client.request('turn/interrupt', { threadId, turnId }).catch(() => {}); }, 200);
    try { await ended; } finally { clearInterval(timer); }
  } finally { client.close(); }
}

export async function runClaude(config, { event, approval, metadata, cancelled = () => false, queryImpl } = {}) {
  const query = queryImpl || (await import('@anthropic-ai/claude-agent-sdk')).query;
  const controller = new AbortController();
  const timer = setInterval(() => { if (cancelled()) controller.abort(); }, 100);
  try {
    async function* imagePrompt() {
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
        { type: 'text', text: config.prompt },
        ...(config.images || []).flatMap(image => [
          { type: 'text', text: 'Attached image: ' + image.name },
          { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } },
        ]),
      ] } };
    }
    const stream = query({ prompt: config.images?.length ? imagePrompt() : config.prompt, options: {
      cwd: config.workspace, pathToClaudeCodeExecutable: config.bin, permissionMode: config.mode === 'read' ? 'plan' : 'default',
      additionalDirectories: [...new Set(config.workspaces || [])].filter(directory => directory !== config.workspace),
      settingSources: [], settings: { disableAllHooks: true }, mcpServers: {}, strictMcpConfig: true, disallowedTools: ['mcp__*'],
      tools: config.mode === 'read' ? ['Read', 'Glob', 'Grep'] : ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
      includePartialMessages: true, ...(config.effort ? { effort: config.effort } : {}), abortController: controller, ...(config.sessionId ? { resume: config.sessionId } : {}), model: config.model || 'default',
      canUseTool: async (toolName, input, options) => {
        if (config.mode === 'read' && !['Read', 'Glob', 'Grep'].includes(toolName)) return { behavior: 'deny', message: 'Read-only mode blocks this tool.' };
        const allow = await approval({ id: options?.toolUseID || `${Date.now()}-${Math.random()}`, kind: toolName, input });
        return allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user declined this action.' };
      },
    } });
    for await (const message of stream) {
      if (message.type === 'stream_event' && (message.event?.content_block?.type === 'thinking' || message.event?.delta?.type === 'thinking_delta')) event({ type: 'relay.progress', phase: 'reasoning' });
      if (message.type === 'system' && message.subtype === 'status' && message.status === 'compacting') event({ type: 'relay.progress', phase: 'compacting' });
      if (message.type === 'system' && message.subtype === 'init') metadata({ effectiveModel: message.model || 'unknown', transport: 'sdk', authMode: message.apiKeySource || 'unknown', effectiveEffort: message.effort ?? config.effort ?? null });
      if (message.type === 'result' && message.modelUsage) metadata({ effectiveModel: Object.keys(message.modelUsage).join(', ') || 'unknown', usage: message.usage, costUSD: message.total_cost_usd });
      event(message);
    }
  } finally { clearInterval(timer); }
}

const logins = new Map();
export function closeAccountConnections() { for (const client of logins.values()) client.close(); logins.clear(); }
export async function accountStatus(provider, { bin = resolveBinary(provider), workspace = os.homedir() } = {}) {
  const base = { installed: false, available: false, authenticated: 'unknown', authMode: 'unknown', billingSource: 'unknown', usage: 'unknown', path: bin, capabilities: capabilities(provider) };
  if (!bin) return base;
  const version = await probeCli(bin, ['--version'], 4000);
  // An installed CLI that answers too slowly is unverified, not missing.
  if (version.timedOut) return { ...base, installed: true, errorCategory: 'timeout' };
  if (version.status !== 0) return { ...base, errorCategory: 'installation' };
  base.installed = base.available = true; base.version = version.stdout.trim().slice(0, 200);
  if (provider === 'gemini') {
    if (isAgy(bin)) {
      return { ...base, available: false, authenticated: 'unknown', authMode: 'native-cli', billingSource: 'unknown', capabilities: { ...base.capabilities, approvals: false, readOnly: 'unavailable' }, message: agyUnsupported };
    }
    return { ...base, authMode: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'api-key-present' : 'native-cli', billingSource: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'api' : 'unknown', message: geminiSetup };
  }
  if (provider === 'claude') {
    const result = await probeCli(bin, ['auth', 'status', '--json'], 5000);
    if (result.timedOut) return { ...base, errorCategory: 'timeout' };
    try {
      const status = JSON.parse(result.stdout);
      return { ...base, authenticated: status.loggedIn ?? 'unknown', authMode: status.authMethod || status.apiKeySource || 'unknown', billingSource: /oauth|claude.?ai/i.test(status.authMethod || '') ? 'subscription' : /api.?key/i.test(status.authMethod || '') ? 'api' : 'unknown', subscriptionType: status.subscriptionType || null };
    } catch { return base; }
  }
  const client = new CodexClient({ bin, cwd: workspace });
  try {
    await client.initialize();
    const { account, requiresOpenaiAuth } = await client.request('account/read', { refreshToken: false });
    let usage = 'unknown';
    try { usage = (await client.request('account/rateLimits/read', {}, 5000)).rateLimits || 'unknown'; } catch {}
    return { ...base, authenticated: account ? (['chatgpt', 'apiKey'].includes(account.type) ? true : 'unknown') : requiresOpenaiAuth === false ? 'unknown' : false, authMode: account?.type || 'unknown', billingSource: account?.type === 'chatgpt' ? 'subscription' : account?.type === 'apiKey' ? 'api' : 'unknown', planType: account?.planType || null, usage };
  } catch (error) { return { ...base, error: error.message, errorCategory: classifyError(error) }; }
  finally { client.close(); }
}
// Plan usage windows, normalized for both providers: [{ id, label, usedPercent, resetsAt, scope? }].
const windowLabel = minutes => minutes >= 10080 ? 'Weekly' : minutes >= 1440 ? 'Daily' : minutes >= 60 ? `${Math.round(minutes / 60)}-hour` : 'Current';
export function codexUsageWindows(limits) {
  return ['primary', 'secondary'].map(id => limits?.[id]).filter(period => typeof period?.usedPercent === 'number').map((period, index) => ({ id: index ? 'secondary' : 'primary', label: windowLabel(period.windowDurationMins), usedPercent: period.usedPercent, resetsAt: Number.isFinite(period.resetsAt) ? new Date(period.resetsAt * 1000).toISOString() : null }));
}
export function claudeUsageWindows(limits) {
  const rows = [['five_hour', '5-hour'], ['seven_day', 'Weekly'], ['seven_day_opus', 'Weekly · Opus', 'opus'], ['seven_day_sonnet', 'Weekly · Sonnet', 'sonnet']].map(([id, label, scope]) => ({ id, label, scope, period: limits?.[id] }));
  for (const [index, period] of (Array.isArray(limits?.model_scoped) ? limits.model_scoped : []).entries()) if (period?.display_name) rows.push({ id: `model-${index}`, label: `Weekly · ${period.display_name}`, scope: String(period.display_name).toLowerCase(), period });
  return rows.filter(row => typeof row.period?.utilization === 'number').map(({ id, label, scope, period }) => ({ id, label, usedPercent: period.utilization, resetsAt: period.resets_at || null, ...(scope ? { scope } : {}) }));
}
const usageCache = new Map();
export function providerUsage(provider, { bin = resolveBinary(provider), workspace = os.homedir(), refresh = false } = {}) {
  const cached = usageCache.get(provider);
  if (!refresh && cached && Date.now() - cached.at < 60000) return cached.promise;
  const promise = readUsage(provider, bin, workspace).catch(error => ({ available: false, reason: error.message || 'Usage could not be read.' })).then(result => ({ provider, checkedAt: new Date().toISOString(), ...result }));
  usageCache.set(provider, { at: Date.now(), promise });
  return promise;
}
async function readUsage(provider, bin, workspace) {
  if (provider === 'gemini') return { available: false, reason: 'Gemini CLI does not expose account quota metadata through this connection. Check your Google account for usage and reset times.' };
  if (!bin) return { available: false, reason: 'Install the provider CLI first.' };
  if (provider === 'claude') {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const controller = new AbortController();
    async function* noPrompt() { await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true })); }
    const stream = query({ prompt: noPrompt(), options: { cwd: workspace, pathToClaudeCodeExecutable: bin, settingSources: [], settings: { disableAllHooks: true }, mcpServers: {}, strictMcpConfig: true, disallowedTools: ['mcp__*'], abortController: controller } });
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      // Claude Code only exposes plan usage through an experimental SDK call; treat its absence as "not reported".
      const read = stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof read !== 'function') return { available: false, reason: 'This Claude Code version does not report plan usage.' };
      const result = await read.call(stream, { skipBehaviors: true });
      const windows = result?.rate_limits_available ? claudeUsageWindows(result.rate_limits) : [];
      return windows.length ? { available: true, plan: result.subscription_type || null, windows } : { available: false, reason: 'Plan usage is reported only for Claude subscription accounts.' };
    } finally { clearTimeout(timeout); controller.abort(); stream.close(); }
  }
  const client = new CodexClient({ bin, cwd: workspace });
  try {
    await client.initialize();
    const limits = (await client.request('account/rateLimits/read', {}, 5000)).rateLimits, windows = codexUsageWindows(limits);
    return windows.length ? { available: true, plan: limits?.planType || null, windows } : { available: false, reason: 'Plan usage is not reported for this account.' };
  } finally { client.close(); }
}
export async function listModels(provider, options = {}) {
  if (provider === 'gemini') {
    const bin = options.bin || resolveBinary(provider);
    if (isAgy(bin)) return { models: [], source: 'unavailable', manualSelection: false, message: agyUnsupported };
    return { models: [], source: 'native-cli', manualSelection: true, message: 'Use the Gemini CLI default or enter a model ID available to your account. The selected model is verified before sending a prompt.' };
  }
  if (provider === 'claude') {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const controller = new AbortController();
    async function* noPrompt() { await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true })); }
    const stream = query({ prompt: noPrompt(), options: { cwd: options.workspace || os.homedir(), pathToClaudeCodeExecutable: options.bin || resolveBinary(provider), settingSources: [], settings: { disableAllHooks: true }, mcpServers: {}, strictMcpConfig: true, disallowedTools: ['mcp__*'], abortController: controller } });
    const timeout = setTimeout(() => controller.abort(), 6000);
    try { const models = await stream.supportedModels(); return { models: models.map(model => ({ ...model, id: model.value, model: model.value })), source: 'provider', manualSelection: true }; }
    finally { clearTimeout(timeout); controller.abort(); stream.close(); }
  }
  const client = new CodexClient({ bin: options.bin || resolveBinary(provider), cwd: options.workspace || os.homedir() });
  try { await client.initialize(); const result = await client.request('model/list', { limit: 100, includeHidden: false }); return { models: result.data, source: 'provider', nextCursor: result.nextCursor }; }
  finally { client.close(); }
}
export async function connectAccount(provider, { bin = resolveBinary(provider), workspace = os.homedir() } = {}) {
  if (provider === 'gemini') {
    if (isAgy(bin)) return { started: false, nativeFlow: true, message: agyUnsupported };
    return { started: false, nativeFlow: true, message: geminiSetup };
  }
  if (!bin) throw Object.assign(new Error('Install the provider CLI first.'), { status: 503 });
  if (provider === 'claude') {
    const child = spawn(bin, ['auth', 'login'], { stdio: ['ignore', 'pipe', 'pipe'], cwd: workspace, shell: false });
    const id = `claude:${child.pid}:${Date.now()}`;
    const timer = setTimeout(() => { child.kill('SIGTERM'); logins.delete(id); }, 10 * 60 * 1000); timer.unref();
    logins.set(id, { close() { clearTimeout(timer); child.kill('SIGTERM'); } });
    child.on('close', () => { clearTimeout(timer); logins.delete(id); });
    child.on('error', () => {}); child.stdout.resume(); child.stderr.resume();
    return { started: true, nativeFlow: true, message: 'Claude Code started its own browser authentication flow. Complete sign-in there, then refresh status. All native authentication choices remain available in the installed CLI.' };
  }
  const client = new CodexClient({ bin, cwd: workspace }); await client.initialize();
  try {
    const login = await client.request('account/login/start', { type: 'chatgpt' });
    logins.set(login.loginId, client);
    const timer = setTimeout(() => { client.close(); logins.delete(login.loginId); }, 10 * 60 * 1000); timer.unref();
    client.on('message', message => { if (message.method === 'account/login/completed') { clearTimeout(timer); client.close(); logins.delete(login.loginId); } });
    return login;
  } catch (error) { client.close(); throw error; }
}
export async function disconnectAccount(provider, { bin = resolveBinary(provider), workspace = os.homedir() } = {}) {
  if (provider === 'gemini') throw Object.assign(new Error('Manage Google and Gemini authentication in the native Antigravity or Gemini CLI. Throughline stores no credentials.'), { status: 400 });
  if (!bin) throw Object.assign(new Error('Install the provider CLI first.'), { status: 503 });
  if (provider === 'claude') { const result = spawnSync(bin, ['auth', 'logout'], { cwd: workspace, encoding: 'utf8', timeout: 5000, shell: false }); if (result.status !== 0) throw new Error(result.stderr || 'Claude logout failed.'); return { disconnected: true }; }
  const client = new CodexClient({ bin, cwd: workspace }); try { await client.initialize(); await client.request('account/logout'); return { disconnected: true }; } finally { client.close(); }
}
