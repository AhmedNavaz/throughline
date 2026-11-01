import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { validatePublicPackage, validateSolution, canonicalStringify } from '../src/collaboration-format.mjs';

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest('hex');
const tokenPattern = /^[A-Za-z0-9_-]{43,128}$/;
function capabilities(value) {
  if (!value || !['view', 'submit', 'owner'].every(key => typeof value[key] === 'string' && tokenPattern.test(value[key]))) {
    throw fail('Three separate random capability tokens are required.');
  }
  if (new Set(Object.values(value)).size !== 3) throw fail('Capability tokens must be different.');
  return Object.fromEntries(['view', 'submit', 'owner'].map(key => [key, digest(value[key])]));
}

// This store accepts approved portable JSON only. It never imports a provider,
// executes a command, resolves a source path, or accesses a project workspace.
export class SharingStore {
  constructor({ dataDir, now = () => Date.now(), maxStorageBytes = 100 * 1024 * 1024,
    maxRequests = 500, maxSolutions = 20 } = {}) {
    if (!dataDir) throw new Error('A sharing data directory is required.');
    this.dataDir = path.resolve(dataDir);
    this.now = now;
    this.maxStorageBytes = maxStorageBytes;
    this.maxRequests = maxRequests;
    this.maxSolutions = maxSolutions;
    this.records = new Map();
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(this.dataDir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const record = JSON.parse(fs.readFileSync(path.join(this.dataDir, name), 'utf8'));
      if (record.id !== name.slice(0, -5) || !record.tokenHashes || !record.uploadId || !Number.isFinite(record.expiresAt)) {
        throw new Error('Invalid sharing storage record.');
      }
      this.records.set(record.id, record);
    }
    this.expire();
  }

  persist(record) {
    const source = JSON.stringify(record);
    const total = [...this.records.values()].filter(item => item.id !== record.id)
      .reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0) + Buffer.byteLength(source);
    if (total > this.maxStorageBytes) throw fail('Sharing storage is full. Try again later or export the request.', 507);
    const filename = path.join(this.dataDir, `${record.id}.json`);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, source);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, filename);
      this.records.set(record.id, record);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  expire() {
    for (const record of this.records.values()) {
      if (record.status === 'active' && record.expiresAt <= this.now()) {
        this.persist({ ...record, status: 'expired', package: null, solutions: [] });
      }
    }
  }

  create({ uploadId, package: input, expiresInSeconds = 604800, capabilities: tokens } = {}) {
    if (typeof uploadId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(uploadId)) throw fail('A stable random upload ID is required.');
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 2592000) throw fail('Expiry must be between 60 seconds and 30 days.');
    const tokenHashes = capabilities(tokens);
    const publicPackage = validatePublicPackage(input);
    const packageHash = digest(canonicalStringify(publicPackage));
    this.expire();
    const existing = [...this.records.values()].find(record => record.uploadId === uploadId);
    if (existing) {
      if (canonicalStringify(existing.tokenHashes) !== canonicalStringify(tokenHashes)
        || existing.packageHash !== packageHash || existing.expiresInSeconds !== expiresInSeconds) {
        throw fail('This upload ID has already been used for different content.', 409);
      }
      if (existing.status !== 'active') throw fail('This request has expired or was revoked.', 410);
      return { created: false, record: this.summary(existing) };
    }
    if ([...this.records.values()].filter(item => item.status === 'active').length >= this.maxRequests) throw fail('The request storage limit has been reached.', 507);
    const record = { id: randomUUID(), uploadId, tokenHashes, packageHash, handoffId: publicPackage.id,
      createdAt: this.now(), expiresAt: this.now() + expiresInSeconds * 1000, expiresInSeconds,
      status: 'active', package: publicPackage, solutions: [] };
    if (Buffer.byteLength(JSON.stringify({ ...this.summary(record), package: publicPackage })) > MAX_BODY_BYTES) throw fail('The approved package exceeds the response limit.', 413);
    this.persist(record);
    return { created: true, record: this.summary(record) };
  }

  summary(record) {
    return { id: record.id, handoffId: record.handoffId, createdAt: new Date(record.createdAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(), status: record.status };
  }

  authorize(id, kind, token, { allowGone = false } = {}) {
    const record = this.records.get(id);
    if (!record) throw fail('Request not found.', 404);
    if (typeof token !== 'string' || !tokenPattern.test(token)) throw fail('This capability is not authorized.', 403);
    const expected = record.tokenHashes[kind];
    const supplied = digest(token);
    if (!expected || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw fail('This capability is not authorized.', 403);
    this.expire();
    const current = this.records.get(id);
    if (current.status !== 'active' && !allowGone) throw fail('This request has expired or was revoked.', 410);
    return current;
  }

  submit(record, input) {
    this.expire();
    record = this.records.get(record.id);
    if (!record || record.status !== 'active') throw fail('This request has expired or was revoked.', 410);
    const solution = validateSolution(input, { handoffId: record.handoffId });
    const existing = record.solutions.find(item => item.id === solution.id);
    if (existing) {
      if (existing.integrity !== solution.integrity) throw fail('This solution ID has already been used for different content.', 409);
      return { created: false, solution: existing };
    }
    if (record.solutions.length >= this.maxSolutions) throw fail('This request has reached its solution limit.', 413);
    // The owner response is bounded independently of the upload request limit.
    if (Buffer.byteLength(JSON.stringify({ ...this.summary(record), solutions: [...record.solutions, solution] })) > MAX_BODY_BYTES) {
      throw fail('The total returned solutions exceed the response limit.', 413);
    }
    this.persist({ ...record, solutions: [...record.solutions, solution] });
    return { created: true, solution };
  }

  revoke(record) {
    this.expire();
    record = this.records.get(record.id);
    if (record.status === 'active') this.persist({ ...record, status: 'revoked', package: null, solutions: [] });
    return this.summary(this.records.get(record.id));
  }
}
