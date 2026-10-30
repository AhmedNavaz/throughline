import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256, validateSolution, validateRelativePath, invalid, MAX_FILE_BYTES } from './collaboration-format.mjs';
import { currentWorkspace, workspaceSnapshot, restrictWorkspace } from './workspace-layout.mjs';
import { readWorkspaceFile, writeWorkspaceFile } from './workspace-files.mjs';

export function atomicJSON(filename, value) {
  fs.mkdirSync(path.dirname(filename), {recursive:true,mode:0o700});
  const temporary = filename + '.' + randomUUID() + '.tmp';
  let fd;
  try {
    fd=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd=undefined;
    fs.renameSync(temporary,filename);
    let directory;
    try { directory=fs.openSync(path.dirname(filename),'r'); fs.fsyncSync(directory); } catch(error) { if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(error.code))throw error; }
    finally { if(directory!==undefined)fs.closeSync(directory); }
  } finally {
    if(fd!==undefined)fs.closeSync(fd);
    try {fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

export function textDiff(relative, before, after) {
  if(before===after)return '';
  const oldLines=before===null?[]:before.split('\n');
  const newLines=after===null?[]:after.split('\n');
  return '--- '+(before===null?'/dev/null':'a/'+relative)+'\n+++ '+(after===null?'/dev/null':'b/'+relative)+'\n@@ -'+(oldLines.length?1:0)+','+oldLines.length+' +'+(newLines.length?1:0)+','+newLines.length+' @@\n'+oldLines.map(line=>'-'+line).concat(newLines.map(line=>'+'+line)).join('\n')+'\n';
}
function privateId(value) { if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw invalid('Invalid private record ID.');return value; }
function validateSnapshot(snapshot) {
  if(!snapshot||!(snapshot.content===null||typeof snapshot.content==='string')||snapshot.content!==null&&(Buffer.byteLength(snapshot.content)>MAX_FILE_BYTES||snapshot.content.includes('\u0000')))throw invalid('Invalid recovery snapshot.');
  if(snapshot.sha256!==(snapshot.content===null?null:sha256(snapshot.content)))throw invalid('Recovery snapshot hash does not match.');
}

export class PatchService {
  constructor({registry,dataRoot}) { this.registry=registry;this.dataRoot=path.resolve(dataRoot); }
  filename(projectId,solutionId) { return path.join(this.dataRoot,'applications',privateId(projectId),privateId(solutionId)+'.json'); }
  getApplication(projectId,solutionId) {
    this.registry.get(projectId);
    const filename=this.filename(projectId,solutionId);
    if(!fs.existsSync(filename))return null;
    const record=JSON.parse(fs.readFileSync(filename,'utf8'));
    if(record.schema!=='ai-relay.recovery'||record.version!==1||record.projectId!==projectId||record.solutionId!==solutionId||!Array.isArray(record.operations)||record.operations.length>128)throw invalid('Invalid recovery checkpoint.');
    for(const operation of record.operations){validateRelativePath(operation.path);validateSnapshot(operation.before);validateSnapshot(operation.after);}
    return record;
  }
  save(record) { atomicJSON(this.filename(record.projectId,record.solutionId),record);return record; }
  checkApproved(solution,baseline) {
    const approved=new Map(baseline.map(file=>[validateRelativePath(file.path),file.sha256]));
    for(const file of solution.patch.files){if(!approved.has(file.path))throw invalid('Patch touches a file that was not approved for this handoff: '+file.path);if(approved.get(file.path)!==file.baseHash)throw invalid('Patch baseline does not match the handoff: '+file.path,409);}
  }
  preview(projectId,input,baseline,{workspace:snapshot}={}) {
    const solution=validateSolution(input);
    this.checkApproved(solution,baseline);
    const workspace=restrictWorkspace(snapshot||currentWorkspace(this.registry,projectId),currentWorkspace(this.registry,projectId));
    const application=this.getApplication(projectId,solution.id);
    const conflicts=[];
    const files=solution.patch.files.map(file=>{
      let before=null;
      try {const current=readWorkspaceFile(workspace,file.path,{allowMissing:true});before=current.content;if(current.sha256!==file.baseHash)conflicts.push({path:file.path,expected:file.baseHash,actual:current.sha256,reason:'File differs from the approved handoff baseline.'});}
      catch(error){conflicts.push({path:file.path,expected:file.baseHash,actual:null,reason:error.message});}
      return {path:file.path,before,after:file.content,operation:file.content===null?'delete':file.baseHash===null?'create':'replace',diff:textDiff(file.path,before,file.content)};
    });
    const status=application?.status==='applied'?'applied':application&&application.status!=='prepared'?'recovery-required':conflicts.length?'stale':files.length?'applicable':'instructions';
    return {solutionId:solution.id,integrity:solution.integrity,status,files,conflicts,application};
  }
  async apply(projectId,input,baseline,{approvedIntegrity,workspace:snapshot}={}) {
    const solution=validateSolution(input);
    if(approvedIntegrity!==solution.integrity)throw invalid('Explicit approval of the exact solution integrity is required.');
    return this.registry.withMutation(projectId,'patch',async()=>{
      const existing=this.getApplication(projectId,solution.id);
      if(existing){if(existing.integrity!==solution.integrity)throw invalid('Solution ID conflicts with the saved application.',409);if(existing.status==='applied')return existing;throw invalid('This application already has a recovery checkpoint. Recover it before using a new solution.',409);}
      const preview=this.preview(projectId,solution,baseline,{workspace:snapshot});
      if(preview.status==='stale')throw Object.assign(invalid('Patch is stale; no files were changed.',409),{conflicts:preview.conflicts});
      if(preview.status!=='applicable')throw invalid('This solution has no applicable text patch.');
      const workspace=restrictWorkspace(snapshot||currentWorkspace(this.registry,projectId),currentWorkspace(this.registry,projectId));
      const record={schema:'ai-relay.recovery',version:1,projectId,solutionId:solution.id,integrity:solution.integrity,workspace:workspaceSnapshot(workspace),status:'prepared',createdAt:new Date().toISOString(),completed:[],operations:solution.patch.files.map(file=>({path:file.path,before:readWorkspaceFile(workspace,file.path,{allowMissing:true}),after:{content:file.content,sha256:file.content===null?null:sha256(file.content),mode:null}})),conflicts:[]};
      this.save(record); // The durable copy exists before the first workspace write.
      try {
        record.status='applying';this.save(record);
        for(const operation of record.operations){writeWorkspaceFile(workspace,operation.path,operation.after.content,{expectedHash:operation.before.sha256,mode:operation.before.mode??0o644});record.completed.push(operation.path);this.save(record);}
        record.status='applied';record.appliedAt=new Date().toISOString();this.save(record);return record;
      } catch(error) {
        record.failure=error.message;
        let recovery;
        try{recovery=this.recoverLocked(projectId,record,{automatic:true});}catch(recoveryError){record.status='recovery-required';record.recoveryError=recoveryError.message;try{this.save(record);}catch{}recovery=record;}
        throw Object.assign(invalid('Patch application failed. '+(recovery.status==='rolled-back'?'Affected files were restored.':'A recovery checkpoint is available; newer changes were preserved.'),409),{application:recovery,cause:error});
      }
    });
  }
  recoverLocked(projectId,record,{automatic=false}={}) {
    const workspace=restrictWorkspace(record.workspace||currentWorkspace(this.registry,projectId),currentWorkspace(this.registry,projectId));
    const conflicts=[];
    const restore=[];
    for(const operation of record.operations){
      try{const current=readWorkspaceFile(workspace,operation.path,{allowMissing:true});if(current.sha256===operation.before.sha256)continue;if(current.sha256===operation.after.sha256)restore.push(operation);else conflicts.push({path:operation.path,reason:'Newer local changes were preserved; recovery will not overwrite them.',actual:current.sha256});}
      catch(error){conflicts.push({path:operation.path,reason:error.message});}
    }
    for(const operation of restore){try{writeWorkspaceFile(workspace,operation.path,operation.before.content,{expectedHash:operation.after.sha256,mode:operation.before.mode??0o644});}catch(error){conflicts.push({path:operation.path,reason:error.message});}}
    record.status=conflicts.length?'recovery-conflict':automatic?'rolled-back':'recovered';record.conflicts=conflicts;record.recoveredAt=new Date().toISOString();return this.save(record);
  }
  async recover(projectId,solutionId) {
    return this.registry.withMutation(projectId,'patch-recovery',async()=>{const record=this.getApplication(projectId,solutionId);if(!record)throw invalid('No application checkpoint exists.',404);if(['recovered','rolled-back'].includes(record.status))return record;return this.recoverLocked(projectId,record);});
  }
}
