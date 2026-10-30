import { workspaceGit, workspaceGitDiff } from './workspace-git.mjs';
import { listFiles, readExplorerFile } from './file-explorer.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

export function createWorkspaceRoutes({ registry, body, json }) {
  return async ({ req, res, url }) => {
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
    if (!['/api/git', '/api/git/diff'].includes(url.pathname)) return false;
    if (req.method !== 'GET') fail('Git activity is read only.', 405);
    const projectId = url.searchParams.get('projectId');
    if (!projectId) fail('Select a workspace first.');
    const project = registry.get(projectId);
    if (url.pathname === '/api/git') { json(res, 200, workspaceGit(project.folders)); return true; }
    const folder = project.folders.find(entry => entry.id === url.searchParams.get('folderId'));
    if (!folder) fail('That folder is no longer in this workspace.', 404);
    json(res, 200, workspaceGitDiff(folder, url.searchParams.get('path') || '')); return true;
  };
}
