import fs from 'node:fs';
import path from 'node:path';
import { validateRelativePath } from './collaboration-format.mjs';
import { describeAttachment, attachmentLimits } from './attachments.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const allowed = value => { try { validateRelativePath(value); return true; } catch { return false; } };
function location(folder, relative = '') {
  if (typeof relative !== 'string') fail('Choose a folder or file.');
  if (relative) validateRelativePath(relative);
  const root = path.resolve(folder.path);
  if (fs.realpathSync(root) !== root) fail('Symbolic-link roots cannot be explored.');
  let target = root;
  for (const part of relative ? relative.split('/') : []) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) fail('Symbolic links are not opened in the explorer.');
  }
  return target;
}
export function listFiles(folder, relative = '', offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) fail('Invalid directory offset.');
  const target = location(folder, relative);
  if (!fs.statSync(target).isDirectory()) fail('Choose a directory.');
  const rows = fs.readdirSync(target, { withFileTypes: true }).filter(entry => (entry.isDirectory() || entry.isFile()) && allowed(relative ? relative + '/' + entry.name : entry.name));
  rows.sort((a,b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { folderId: folder.id, path: relative, entries: rows.slice(offset, offset + 200).map(entry => ({ name: entry.name, path: relative ? relative + '/' + entry.name : entry.name, kind: entry.isDirectory() ? 'directory' : 'file' })), nextOffset: rows.length > offset + 200 ? offset + 200 : null };
}
export function readExplorerFile(folder, relative) {
  if (!relative) fail('Choose a file.');
  const target = location(folder, relative);
  let fd;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail('Only regular files can be previewed.');
    if (fs.realpathSync(target) !== target) fail('The file path changed while opening it. Try again.', 409);
    if (stat.size > attachmentLimits.imageBytes) fail('Preview supports images up to 5 MB and text/code up to 64 KB.', 413);
    const bytes = Buffer.alloc(stat.size + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length !== stat.size) fail('The file changed while reading. Try again.', 409);
    const contents = bytes.subarray(0, length), meta = describeAttachment(path.basename(relative), contents);
    return { ...meta, folderId: folder.id, path: relative, data: contents.toString('base64'), ...(meta.kind === 'text' ? { text: contents.toString('utf8') } : {}) };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
