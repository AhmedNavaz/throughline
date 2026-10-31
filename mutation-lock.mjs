import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const fail = message => Object.assign(new Error(message), { status: 409 });
const exists = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
let ownStart;
// The start time the kernel stored when the process began, so a clock correction doesn't change it. The time zone
// and language are fixed so ps prints it the same way for every instance. It is only read on macOS.
export function processStart(pid) {
  if (pid === process.pid && ownStart) return ownStart;
  if (process.platform !== 'darwin' || !Number.isSafeInteger(pid) || pid <= 0) return null;
  const start = spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).stdout?.trim() || null;
  if (pid === process.pid) ownStart = start;
  return start;
}
// A process ID saved with a start time belongs to another process once the process using it reports a different one.
// Locks from earlier versions have no start time, and an unreadable one counts as unchanged, so a live ID still holds the lock.
export function reused(pid, start) {
  if (!start) return false;
  const now = processStart(pid);
  return Boolean(now) && now !== start;
}
const alive = (pid, start) => exists(pid) && !reused(pid, start);
// A group ID is its leader's PID, and no new process gets it while the group exists. So a process using it with
// another start time means the group has ended. A leader that exited alone has no start time, so its group still counts.
function groupAlive(pid, start) { return process.platform !== 'win32' && pid ? exists(-pid) && !reused(pid, start) : false; }
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
// Locks and leases are written under a temporary name and renamed into place, so a write that fails (on a full disk,
// for example) or stops partway leaves no empty file behind to block later changes.
function atomicWrite(filename, contents) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, filename); }
  finally { fs.rmSync(temporary, { force: true }); }
}
export function acquireProjectLock(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'server.lock');
  const contents = JSON.stringify({ pid: process.pid, token: randomUUID(), pidStart: processStart(process.pid) });
  withFileGuard(filename, () => {
    if (fs.existsSync(filename)) {
      const raw = fs.readFileSync(filename, 'utf8');
      let pid, pidStart;
      try { ({ pid, pidStart } = raw.trim().startsWith('{') ? JSON.parse(raw) : { pid: Number(raw) }); } catch { throw fail(`Invalid project lock: ${filename}`); }
      if (!Number.isSafeInteger(pid) || pid <= 0) throw fail(`Invalid project lock: ${filename}`);
      if (alive(pid, pidStart)) throw fail(`Throughline is already running for this project (process ${pid}).`);
      fs.unlinkSync(filename);
    }
    atomicWrite(filename, contents);
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
    const value = { id, workspace: workspaces[0], workspaces, operation, pid: process.pid, pidStart: processStart(process.pid), processGroup: null, processGroupStart: null, createdAt: new Date().toISOString() };
    withFileGuard(coordinator, () => {
      for (const name of fs.readdirSync(this.root).filter(name => name.endsWith('.json'))) {
        const full = path.join(this.root, name);
        // A lease that can't be read has no known owner, so it is kept and blocks changes until it is removed by hand.
        let other;
        try { other = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { throw fail(`Project files are locked by a lease that cannot be read: ${full}. Remove it only after all Throughline instances are stopped.`); }
        if (!alive(other.pid, other.pidStart) && !groupAlive(other.processGroup, other.processGroupStart)) { fs.unlinkSync(full); continue; }
        const otherRoots = other.workspaces || [other.workspace];
        // Leases from earlier versions hold folders as they were typed, so compare their paths on disk too.
        const otherFolders = otherRoots.map(root => { try { return fs.realpathSync.native(root); } catch { return root; } });
        if (workspaces.some(workspace => otherFolders.some(folder => overlaps(workspace, folder)))) throw fail(`Project files are busy: ${other.operation} is active in an overlapping workspace.`);
      }
      atomicWrite(filename, JSON.stringify(value));
    });
    let released = false;
    return {
      id,
      setProcess(pid, start = processStart(pid)) {
        withFileGuard(coordinator,()=>{value.processGroup=pid;value.processGroupStart=start;atomicWrite(filename,JSON.stringify(value));});
      },
      release() {
        if(!released)withFileGuard(coordinator,()=>{fs.unlinkSync(filename);released=true;});
      },
    };
  }
  async withMutation(workspace, operation, callback) { return this.withMutations([workspace], operation, callback); }
  async withMutations(workspaces, operation, callback) { const lease = this.acquireMany(workspaces, operation); try { return await callback(); } finally { lease.release(); } }
}
