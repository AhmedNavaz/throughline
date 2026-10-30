import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
const fail = message => Object.assign(new Error(message), { status: 409 });
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
function groupAlive(pid) { return process.platform !== 'win32' && pid ? alive(-pid) : false; }
export function withFileGuard(filename, callback) {
  const guard = `${filename}.guard`;
  const deadline=Date.now()+500;
  const pause=new Int32Array(new SharedArrayBuffer(4));
  for(;;) {
    try {fs.mkdirSync(guard,{mode:0o700});break;}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      if(Date.now()>=deadline)throw fail(`Another operation is updating ${path.basename(filename)}. Retry. If the application crashed while holding this guard, inspect and remove ${guard} only after all Throughline instances are stopped.`);
      // Guards protect short synchronous filesystem transactions. Another process
      // may finish normally; don't mistake that brief contention for a crash.
      Atomics.wait(pause,0,0,10);
    }
  }
  try { return callback(); } finally { fs.rmdirSync(guard); }
}
export function acquireProjectLock(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'server.lock');
  const contents = JSON.stringify({ pid: process.pid, token: randomUUID() });
  withFileGuard(filename, () => {
    if (fs.existsSync(filename)) {
      const raw = fs.readFileSync(filename, 'utf8');
      let pid;
      try { pid = raw.trim().startsWith('{') ? JSON.parse(raw).pid : Number(raw); } catch { throw fail(`Invalid project lock: ${filename}`); }
      if (!Number.isSafeInteger(pid) || pid <= 0 || alive(pid)) throw fail(`Throughline is already running for this project (process ${pid}).`);
      fs.unlinkSync(filename);
    }
    fs.writeFileSync(filename, contents, { flag: 'wx', mode: 0o600 });
  });
  return () => withFileGuard(filename, () => { if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === contents) fs.unlinkSync(filename); });
}
function overlaps(first, second) {
  const relative = path.relative(first, second);
  const reverse = path.relative(second, first);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) || (!reverse.startsWith(`..${path.sep}`) && reverse !== '..' && !path.isAbsolute(reverse));
}
export class MutationCoordinator {
  constructor(dataRoot) {
    // Workspace mutations must also exclude runs using another history/data root.
    this.root = path.join(os.tmpdir(), `ai-relay-mutations-${process.getuid?.() ?? os.userInfo().username}`);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  acquire(workspace, operation) {
    return this.acquireMany([workspace], operation);
  }
  acquireMany(workspaces, operation) {
    if (!Array.isArray(workspaces) || !workspaces.length) throw fail('A workspace must contain at least one folder.');
    workspaces = [...new Set(workspaces.map(workspace => {
      // The native realpath matches letter case to the disk, so leases taken through differently typed paths still overlap.
      try { return fs.realpathSync.native(workspace); }
      catch (error) {
        // A saved canonical folder can become unavailable. Retain its absolute
        // identity while removing it from project membership under this lease.
        if (['ENOENT', 'ENOTDIR'].includes(error.code) && path.isAbsolute(workspace)) return path.resolve(workspace);
        throw error;
      }
    }))];
    const id = randomUUID();
    const filename = path.join(this.root, `${id}.json`);
    const coordinator = path.join(this.root,'coordinator');
    const value = { id, workspace: workspaces[0], workspaces, operation, pid: process.pid, processGroup: null, createdAt: new Date().toISOString() };
    withFileGuard(coordinator, () => {
      for (const name of fs.readdirSync(this.root).filter(name => name.endsWith('.json'))) {
        const full = path.join(this.root, name);
        const other = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!alive(other.pid) && !groupAlive(other.processGroup)) { fs.unlinkSync(full); continue; }
        const otherRoots = other.workspaces || [other.workspace];
        // Leases from earlier versions hold folders as they were typed, so compare their paths on disk too.
        const otherFolders = otherRoots.map(root => { try { return fs.realpathSync.native(root); } catch { return root; } });
        if (workspaces.some(workspace => otherFolders.some(folder => overlaps(workspace, folder)))) throw fail(`Project files are busy: ${other.operation} is active in an overlapping workspace.`);
      }
      fs.writeFileSync(filename, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    });
    let released = false;
    return {
      id,
      setProcess(pid) {
        withFileGuard(coordinator,()=>{value.processGroup=pid;fs.writeFileSync(filename,JSON.stringify(value),{mode:0o600});});
      },
      release() {
        if(!released)withFileGuard(coordinator,()=>{fs.unlinkSync(filename);released=true;});
      },
    };
  }
  async withMutation(workspace, operation, callback) { return this.withMutations([workspace], operation, callback); }
  async withMutations(workspaces, operation, callback) { const lease = this.acquireMany(workspaces, operation); try { return await callback(); } finally { lease.release(); } }
}
