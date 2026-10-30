import fs from 'node:fs';
import path from 'node:path';
import { workspaceGit, workspaceGitDiff } from './workspace-git.mjs';
import { exportConversation, readConversationPackage } from './conversation-export.mjs';
import { ConversationImporter } from './conversation-import.mjs';
import { listFiles, readExplorerFile } from './file-explorer.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const existingFolder = value => { try { const folder = fs.realpathSync(value); return fs.statSync(folder).isDirectory() ? folder : null; } catch { return null; } };
const inside = (folder, root) => folder === root || folder.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

export function createWorkspaceRoutes({ registry, body, json, importer = new ConversationImporter() }) {
  // Imports reviewed Claude/Codex conversations into a new workspace (from their folders) or an existing one, merged by time.
  async function importSessions(input) {
    const selected = Array.isArray(input.sessions) ? input.sessions : [], files = Array.isArray(input.files) ? input.files : [];
    const count = selected.length + files.length;
    if (!count || count > 20) fail('Choose between 1 and 20 conversations to import.');
    if (new Set(selected.map(item => `${item?.provider}:${item?.sessionId}`)).size !== selected.length) fail('Each conversation can be selected only once.');
    const previews = [];
    for (const item of selected) {
      const preview = await importer.preview(item.provider, item.sessionId, null);
      if (item.approvedDigest !== preview.digest) fail(`“${preview.title}” changed since you reviewed it. Review it again before importing.`, 409);
      previews.push(preview);
    }
    for (const item of files) {
      const preview = readConversationPackage(item?.package);
      if (item.approvedDigest !== preview.digest) fail(`“${preview.title}” is not the file you reviewed. Open it again before importing.`, 409);
      if (previews.some(entry => entry.provider === 'file' && entry.sessionId === preview.sessionId)) fail('Each conversation file can be selected only once.');
      previews.push(preview);
    }
    // Shared files carry folder names only; the recipient chooses the matching local folders.
    const chosenFolders = Array.isArray(input.folders) ? input.folders.filter(folder => typeof folder === 'string' && folder.trim()).slice(0, 32) : [];
    const sourceFolders = [...new Set(previews.map(preview => preview.cwd).filter(Boolean))];
    const folders = [...new Set(sourceFolders.map(existingFolder).filter(Boolean))], missingFolders = sourceFolders.filter(folder => !existingFolder(folder));
    let project;
    if (input.projectId) {
      project = registry.get(input.projectId);
      for (const folder of folders) if (!project.folders.some(entry => inside(folder, entry.path))) project = registry.addFolder(project.id, folder);
    } else {
      if (!folders.length && !chosenFolders.length) fail(previews.every(preview => preview.provider === 'file') ? 'Choose the folder on this computer where you keep this project.' : 'The project folders of these conversations no longer exist on this computer. Create a workspace for the current folder, then import into it.', 422);
      project = registry.add({ ...(typeof input.name === 'string' && input.name.trim() ? { name: input.name } : {}), folders: [...folders, ...chosenFolders] });
    }
    const result = await registry.withMutation(project.id, 'conversation-import', async () => {
      const conversation = registry.mainConversation(project.id), broker = registry.broker(project.id), c = broker.get(conversation.id);
      const result = broker.importTranscripts(c, previews);
      // A shared file's saved goal, decisions and tasks fill only fields this conversation has not set.
      if (!result.duplicate) for (const shared of previews.map(preview => preview.context).filter(Boolean)) {
        const current = c.context || {}, next = {};
        for (const key of ['goal', 'summary']) if (!current[key] && shared[key]) next[key] = shared[key];
        for (const key of ['decisions', 'tasks']) if (!current[key]?.length && shared[key]?.length) next[key] = shared[key];
        if (Object.keys(next).length) broker.updateContext(c, next);
      }
      return result;
    });
    return { ...result, projectId: project.id, projectName: project.name, conversations: previews.length, missingFolders };
  }

  return async ({ req, res, url }) => {
    if (url.pathname === '/api/import-sources' || url.pathname.startsWith('/api/import-sources/')) {
      if (req.method === 'GET' && url.pathname === '/api/import-sources') {
        const folders = url.searchParams.get('scope') === 'workspace' ? registry.get(url.searchParams.get('projectId') || '').folders : null;
        json(res, 200, await importer.list(url.searchParams.get('provider'), folders, { cursor: url.searchParams.get('cursor') })); return true;
      }
      if (req.method !== 'POST') fail('Use POST for previewing or importing conversations.', 405);
      const input = await body(req);
      if (url.pathname === '/api/import-sources/preview') { json(res, 200, await importer.preview(input.provider, input.sessionId, null)); return true; }
      if (url.pathname === '/api/import-sources/file-preview') { json(res, 200, readConversationPackage(input.package)); return true; }
      if (url.pathname === '/api/import-sources/import') { json(res, 200, await importSessions(input)); return true; }
      fail('Not found.', 404);
    }
    if (['/api/files', '/api/files/preview', '/api/attachments', '/api/attachments/preview'].includes(url.pathname)) {
      const projectId = url.searchParams.get('projectId');
      if (!projectId) fail('Select a workspace first.');
      const project = registry.get(projectId);
      if (url.pathname.startsWith('/api/attachments')) {
        const store = registry.broker(projectId).attachments;
        if (req.method === 'POST' && url.pathname === '/api/attachments') {
          const input = await body(req, 7 * 1024 * 1024);
          registry.get(projectId); // It may have been removed during upload.
          json(res, 201, store.put(input)); return true;
        }
        if (req.method === 'GET' && url.pathname === '/api/attachments/preview') {
          json(res, 200, store.read(url.searchParams.get('id'))); return true;
        }
        fail('Unsupported attachment operation.', 405);
      }
      if (req.method !== 'GET') fail('The file explorer is read only.', 405);
      const folder = project.folders.find(entry => entry.id === url.searchParams.get('folderId'));
      if (!folder) fail('That folder is no longer in this workspace.', 404);
      const relative = url.searchParams.get('path') || '';
      json(res, 200, url.pathname === '/api/files' ? listFiles(folder, relative, Number(url.searchParams.get('offset') || 0)) : readExplorerFile(folder, relative)); return true;
    }
    if (!['/api/git', '/api/git/diff', '/api/imports', '/api/imports/preview', '/api/conversation/export'].includes(url.pathname)) return false;
    const projectId = url.searchParams.get('projectId');
    if (!projectId) throw Object.assign(new Error('Select a workspace first.'), { status: 400 });
    const project = registry.get(projectId), folders = project.folders;
    if (req.method === 'GET' && url.pathname === '/api/git') { json(res, 200, workspaceGit(folders)); return true; }
    if (req.method === 'GET' && url.pathname === '/api/conversation/export') {
      json(res, 200, exportConversation(registry.mainConversation(projectId), project, { range: url.searchParams.get('range') || 'all', activity: url.searchParams.get('activity') === '1', redact: url.searchParams.get('redact') !== '0' })); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/git/diff') {
      const folder = folders.find(entry => entry.id === url.searchParams.get('folderId'));
      if (!folder) throw Object.assign(new Error('That folder is no longer in this workspace.'), { status: 404 });
      json(res, 200, workspaceGitDiff(folder, url.searchParams.get('path') || '')); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/imports') { json(res, 200, await importer.list(url.searchParams.get('provider'), folders, { cursor: url.searchParams.get('cursor') })); return true; }
    if (req.method !== 'POST') throw Object.assign(new Error('Use POST for previewing or importing a conversation.'), { status: 405 });
    const input = await body(req);
    const preview = await importer.preview(input.provider, input.sessionId, folders);
    if (url.pathname === '/api/imports/preview') { json(res, 200, preview); return true; }
    if (input.approvedDigest !== preview.digest) throw Object.assign(new Error('The source conversation changed. Refresh and review its preview before importing.'), { status: 409 });
    const result = await registry.withMutation(projectId, 'conversation-import', async () => {
      const current = registry.get(projectId);
      if (JSON.stringify(current.folders) !== JSON.stringify(folders)) throw Object.assign(new Error('Workspace folders changed. Preview the import again.'), { status: 409 });
      const conversation = registry.mainConversation(projectId);
      return registry.broker(projectId).importTranscript(registry.broker(projectId).get(conversation.id), preview);
    });
    json(res, 200, result); return true;
  };
}
