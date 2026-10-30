import { execFile } from 'node:child_process';

// Read-only status probes must not block the server or leave a timed-out CLI running.
export function probeCli(bin, args, timeout) {
  return new Promise(resolve => {
    execFile(bin, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', shell: false }, (error, stdout, stderr) => {
      // execFile marks a child it killed at the timeout, so a slow CLI is not mistaken for a missing one.
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : null) : 0, timedOut: error?.killed === true, stdout, stderr });
    });
  });
}
