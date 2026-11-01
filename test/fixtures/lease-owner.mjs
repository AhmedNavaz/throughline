import { spawn } from 'node:child_process';
import { MutationCoordinator } from '../../src/mutation-lock.mjs';
const lease = new MutationCoordinator().acquire(process.argv[2], 'provider:codex');
// The assistant's leader exits when this owner does, while a command it started keeps running in its group.
const assistant = spawn('/bin/sh', ['-c', 'sleep 30 & read line'], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
lease.setProcess(assistant.pid);
process.send({ id: lease.id, assistant: assistant.pid });
setInterval(() => {}, 1000);
