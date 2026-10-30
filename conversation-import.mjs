import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CodexClient } from './providers.mjs';
import { resolveBinary } from './resolve-binary.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const providers = ['codex', 'claude'];
const MAX_BYTES = 2 * 1024 * 1024;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isoTime = (value, scale = 1) => { const time = typeof value === 'number' ? value * scale : Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : undefined; };
const ownPrompt = /You are working in (?:Throughline|AI Relay)/;
const relaySession = text => ownPrompt.test(String(text || ''));
const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block?.type === 'text' || block?.type === 'input_text' || block?.type === 'output_text').map(block => block.text || '').join('\n') : '';
// Claude Code saves slash commands and their local output as user turns; they are not part of the conversation.
const commandMarkup = /<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>/g;
export const conversationText = text => String(text || '').replace(commandMarkup, '').trim();
export function conversationTitle(input, fallback = 'Untitled conversation') {
  let text = conversationText(input) || fallback;
  if (ownPrompt.test(text)) {
    try { const envelope = JSON.parse(text.slice(text.indexOf('{'))); if (typeof envelope.currentRequest === 'string' && envelope.currentRequest.trim()) text = envelope.currentRequest; else text = 'Throughline coding session'; }
    catch { text = 'Throughline coding session'; }
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}
export class ConversationImporter {
  constructor({ clientFactory = options => new CodexClient(options), sdkLoader = () => import('@anthropic-ai/claude-agent-sdk'), codexBin = () => resolveBinary('codex') } = {}) { this.clientFactory = clientFactory; this.sdkLoader = sdkLoader; this.codexBin = codexBin; }
  async withCodex(workspace, fn) {
    const bin = this.codexBin(); if (!bin) fail('Install Codex CLI to browse its conversations.', 503);
    const client = this.clientFactory({ bin, cwd: workspace });
    try { await client.initialize(); return await fn(client); } finally { client.close(); }
  }
  // Without folders, lists conversations from every project on this computer (newest first), excluding Throughline's own runs.
  async list(provider, folders, { cursor } = {}) {
    if (!providers.includes(provider)) fail('Choose Codex or Claude.');
    if (!folders) return this.discover(provider, { cursor });
    const roots = folders.map(folder => path.resolve(folder.path));
    if (provider === 'codex') return this.withCodex(roots[0], async client => {
      const result = await client.request('thread/list', { cwd: roots, limit: 50, sortKey: 'updated_at', sourceKinds: ['cli', 'vscode', 'appServer', 'exec'], ...(cursor ? { cursor } : {}) });
      return { sessions: (result.data || []).filter(row => roots.includes(path.resolve(row.cwd || ''))).map(row => ({ id: row.id, title: conversationTitle(row.name || row.preview, 'Codex conversation'), provider, updatedAt: new Date((row.updatedAt || row.createdAt) * 1000).toISOString(), folder: folders[roots.indexOf(path.resolve(row.cwd))]?.displayName || path.basename(row.cwd), cwd: row.cwd })), nextCursor: result.nextCursor || null };
    });
    const sdk = await this.sdkLoader(), sessions = [];
    for (const folder of folders) {
      const rows = await sdk.listSessions({ dir: folder.path, limit: 50, includeWorktrees: false });
      for (const row of rows) {
        if (row.cwd && !roots.includes(path.resolve(row.cwd))) continue;
        if (!sessions.some(item => item.id === row.sessionId)) sessions.push({ id: row.sessionId, title: conversationTitle(row.customTitle || row.summary || row.firstPrompt, 'Claude conversation'), provider, updatedAt: new Date(row.lastModified).toISOString(), folder: folder.displayName || folder.name, cwd: row.cwd || folder.path });
      }
    }
    return { sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100), nextCursor: null };
  }
  async discover(provider, { cursor } = {}) {
    const row = (id, title, updatedAt, cwd) => ({ id, title, provider, updatedAt, cwd: cwd || null, folder: cwd ? path.basename(cwd) : 'Unknown folder' });
    if (provider === 'codex') return this.withCodex(os.homedir(), async client => {
      const result = await client.request('thread/list', { limit: 50, sortKey: 'updated_at', sourceKinds: ['cli', 'vscode', 'appServer', 'exec'], ...(cursor ? { cursor } : {}) });
      return { sessions: (result.data || []).filter(thread => !relaySession(thread.preview) && !relaySession(thread.name)).map(thread => row(thread.id, conversationTitle(thread.name || thread.preview, 'Codex conversation'), new Date((thread.updatedAt || thread.createdAt) * 1000).toISOString(), thread.cwd)), nextCursor: result.nextCursor || null };
    });
    const sdk = await this.sdkLoader(), offset = Number.parseInt(cursor || '0', 10) || 0, limit = 50;
    // Programmatic sessions include Throughline's own Claude runs.
    const rows = await sdk.listSessions({ limit, offset, includeProgrammatic: false });
    return { sessions: rows.map(session => row(session.sessionId, conversationTitle(session.customTitle || session.summary || session.firstPrompt, 'Claude conversation'), new Date(session.lastModified).toISOString(), session.cwd)), nextCursor: rows.length === limit ? String(offset + limit) : null };
  }
  // Without folders the conversation may come from any project; its folder is returned as cwd.
  async preview(provider, sessionId, folders) {
    if (!providers.includes(provider) || typeof sessionId !== 'string' || !/^[\w-]{1,128}$/.test(sessionId)) fail('Choose a valid conversation.');
    const roots = folders?.map(folder => path.resolve(folder.path));
    let messages = [], title = '', clipped = false, cwd = null;
    if (provider === 'codex') await this.withCodex(roots?.[0] || os.homedir(), async client => {
      const { thread } = await client.request('thread/read', { threadId: sessionId });
      if (roots && !roots.includes(path.resolve(thread.cwd || ''))) fail('This conversation belongs to a different workspace.', 403);
      cwd = thread.cwd || null;
      title = conversationTitle(thread.name || thread.preview, 'Codex conversation');
      let cursor;
      for (let page = 0; page < 10; page++) {
        let result;
        try { result = await client.request('thread/turns/list', { threadId: sessionId, itemsView: 'full', sortDirection: 'desc', limit: 50, ...(cursor ? { cursor } : {}) }); }
        catch (error) {
          if (page || !/method|unsupported|not found/i.test(error.message)) throw error;
          const full = await client.request('thread/read', { threadId: sessionId, includeTurns: true });
          result = { data: [...(full.thread.turns || [])].reverse() };
        }
        const turns = [];
        for (const turn of [...(result.data || [])].reverse()) for (const item of turn.items || []) {
          const role = item.type === 'userMessage' ? 'user' : item.type === 'agentMessage' ? 'assistant' : null;
          const text = role === 'user' ? conversationText(textOf(item.content)) : item.text;
          const timestamp = isoTime(role === 'user' ? turn.startedAt : turn.completedAt || turn.startedAt, 1000);
          if (role && typeof text === 'string' && text.trim()) turns.push({ sourceId: String(item.id || digest([turn.id, role, text])), role, text, ...(turn.model ? { model: turn.model } : {}), ...(timestamp ? { timestamp } : {}) });
        }
        messages.unshift(...turns); cursor = result.nextCursor;
        if (!cursor) break;
        if (page === 9 || Buffer.byteLength(JSON.stringify(messages)) > MAX_BYTES) { clipped = true; break; }
      }
    });
    else {
      const sdk = await this.sdkLoader();
      let found;
      if (!folders) { const info = await sdk.getSessionInfo(sessionId, {}); if (info) found = { info, dir: null }; }
      else for (const folder of folders) { const info = await sdk.getSessionInfo(sessionId, { dir: folder.path }); if (info && (!info.cwd || roots.includes(path.resolve(info.cwd)))) { found = { info, dir: folder.path }; break; } }
      if (!found) fail(folders ? 'This conversation was not found in the attached workspace folders.' : 'This conversation was not found.', 404);
      cwd = found.info.cwd || found.dir || null;
      title = conversationTitle(found.info.customTitle || found.info.summary, 'Claude conversation');
      const rows = await sdk.getSessionMessages(sessionId, { ...(found.dir ? { dir: found.dir } : {}), limit: 2000 });
      for (const row of rows) {
        if (!['user', 'assistant'].includes(row.type) || row.parent_tool_use_id) continue;
        const raw = textOf(typeof row.message === 'string' ? row.message : row.message?.content), text = row.type === 'user' ? conversationText(raw) : raw;
        const timestamp = isoTime(row.timestamp);
        if (text.trim()) messages.push({ sourceId: row.uuid || digest([row.type, text]), role: row.type, text, ...(row.message?.model ? { model: row.message.model } : {}), ...(timestamp ? { timestamp } : {}) });
      }
      clipped = rows.length >= 2000;
    }
    while (messages.length > 1000 || Buffer.byteLength(JSON.stringify(messages)) > MAX_BYTES) { messages.shift(); clipped = true; }
    if (!messages.length) fail('This conversation has no importable text messages.', 422);
    const value = { provider, sessionId, title, cwd, messages, clipped };
    return { ...value, digest: digest(value), messageCount: messages.length };
  }
}
