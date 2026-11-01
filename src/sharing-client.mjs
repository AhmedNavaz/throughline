import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { validatePublicPackage, validateSolution, canonicalStringify } from './collaboration-format.mjs';

const LIMIT = 2 * 1024 * 1024;
const token = () => randomBytes(32).toString('base64url');
export function validateSharingURL(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid sharing service URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use an HTTPS sharing service URL, or HTTP on localhost for development.');
  }
  return url.origin;
}

// The local app must call publish only after the user approves the actual package.
// This transport has no connection to the model execution boundary.
export class SharingClient {
  constructor({ baseUrl, storePath, fetchImpl = globalThis.fetch, createKey } = {}) {
    this.baseUrl = validateSharingURL(baseUrl);
    this.storePath = storePath;
    this.fetch = fetchImpl;
    this.createKey = createKey;
    this.records = new Map();
    if (storePath && fs.existsSync(storePath)) {
      const source = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (source.version !== 1 || !Array.isArray(source.deliveries)) throw new Error('Invalid local sharing delivery store.');
      for (const record of source.deliveries) this.records.set(record.requestId, record);
    }
  }

  save(record) {
    this.records.set(record.requestId, structuredClone(record));
    if (this.storePath) {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true, mode: 0o700 });
      const temporary = `${this.storePath}.${randomUUID()}.tmp`;
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify({ version: 1, deliveries: [...this.records.values()] })); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        fs.renameSync(temporary, this.storePath);
      } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    }
    return structuredClone(record);
  }

  list() { return [...this.records.values()].map(record => structuredClone(record)); }
  status(requestId) { const record = this.records.get(requestId); return record ? structuredClone(record) : null; }

  async request(base, route, { token: auth, method = 'GET', value, create = false } = {}) {
    const service = validateSharingURL(base);
    let response;
    try {
      response = await this.fetch(`${service}${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(value !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(create && this.createKey ? { 'X-Sharing-Create-Key': this.createKey } : {}),
      }, ...(value !== undefined ? { body: JSON.stringify(value) } : {}) });
    } catch { throw Object.assign(new Error('Sharing service is unreachable. Your approved package is saved; retry or export it offline.'), { retryable: true }); }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > LIMIT) throw new Error('The sharing response exceeds 2 MiB.');
      chunks.push(chunk);
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('The sharing service returned an invalid response.'); }
    if (!response.ok) throw Object.assign(new Error(result.error || 'The sharing request failed.'), {
      status: response.status, retryable: response.status >= 500 || response.status === 429,
    });
    return result;
  }

  async publish(input, { requestId = input?.id, expiresInSeconds = 604800 } = {}) {
    const publicPackage = validatePublicPackage(input);
    if (typeof requestId !== 'string' || !requestId) throw new Error('A local request ID is required.');
    let record = this.records.get(requestId);
    if (record && ['revoked', 'expired'].includes(record.status)) throw Object.assign(new Error('This request has expired or was revoked. Create a new approved request.'), { status: 410 });
    if (record && (canonicalStringify(record.package) !== canonicalStringify(publicPackage)
      || record.serviceURL !== this.baseUrl || record.expiresInSeconds !== expiresInSeconds)) {
      throw new Error('A published request cannot change content, service, or expiry. Create a new approved request.');
    }
    record ||= { requestId, uploadId: token(), serviceURL: this.baseUrl, handoffId: publicPackage.id,
      viewToken: token(), submitToken: token(), ownerToken: token(), package: publicPackage,
      expiresInSeconds, status: 'pending', solutions: [] };
    this.save(record);
    try {
      const remote = await this.request(this.baseUrl, '/api/requests', { method: 'POST', create: true, value: {
        uploadId: record.uploadId, package: publicPackage, expiresInSeconds,
        capabilities: { view: record.viewToken, submit: record.submitToken, owner: record.ownerToken },
      } });
      if (!/^[a-f0-9-]{36}$/.test(remote.id) || remote.handoffId !== publicPackage.id || !Number.isFinite(Date.parse(remote.expiresAt))) {
        throw new Error('The sharing service returned invalid request metadata.');
      }
      record = { ...record, remoteId: remote.id, expiresAt: remote.expiresAt, status: remote.status,
        viewURL: `${this.baseUrl}/r/${remote.id}#view=${record.viewToken}&submit=${record.submitToken}`,
        localOnly: new URL(this.baseUrl).protocol === 'http:', lastError: null };
      return this.save(record);
    } catch (error) {
      this.save({ ...record, status: error.status === 410 ? 'expired' : 'pending', lastError: error.message });
      throw error;
    }
  }

  async retrieve(input) {
    const record = this.records.get(input.requestId) || input;
    if (!record.remoteId) throw new Error('This request has not been delivered yet. Retry publishing it first.');
    try {
      const result = await this.request(record.serviceURL, `/api/requests/${record.remoteId}/solutions`, { token: record.ownerToken });
      if (result.id !== record.remoteId || result.handoffId !== record.handoffId || !Array.isArray(result.solutions)) throw new Error('Invalid owner response.');
      const solutions = result.solutions.map(solution => validateSolution(solution, { handoffId: record.handoffId }));
      this.save({ ...record, status: result.status, solutions, lastPolledAt: new Date().toISOString(), lastError: null });
      return { ...result, solutions };
    } catch (error) {
      this.save({ ...record, status: error.status === 410 ? 'expired' : record.status, lastError: error.message });
      throw error;
    }
  }

  async revoke(input) {
    const record = this.records.get(input.requestId) || input;
    if (!record.remoteId) return this.save({ ...record, status: 'revoked', lastError: null });
    const result = await this.request(record.serviceURL, `/api/requests/${record.remoteId}/revoke`, {
      token: record.ownerToken, method: 'POST', value: {},
    });
    return this.save({ ...record, status: result.status, lastError: null });
  }
}
