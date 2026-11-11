import {readFile,stat} from 'node:fs/promises';
import {relative,resolve,sep} from 'node:path';
import {WORKSPACE_ROOT} from './data.mjs';
import {sourceReferencePath} from './source-data.mjs';

// Only explicit app-owned file references are resolved here. Ticket identifiers,
// photo UUIDs and prose citations retain their own domain meaning.
export function referencedEvidenceFiles(rows,{root=WORKSPACE_ROOT}={}){
  const files=new Set(),base=resolve(root);
  for(const row of rows)for(const reference of String(row['证据引用']||'').split('；')){
    const name=reference.trim().split('#')[0];
    if(!name.startsWith('private/')&&!name.startsWith('inputs/')&&!name.startsWith(base+sep))continue;
    const path=resolve(base,name),rel=relative(base,path);
    if(rel==='..'||rel.startsWith('..'+sep))throw new Error('证据文件不能越出app目录：'+name);
    files.add(rel);
  }
  return [...files].sort();
}

export async function validateLinks(vault,rows,{root=WORKSPACE_ROOT,source}={}){
  source ||= {type:'obsidian',base:resolve(vault)};
  const links=new Set(rows.flatMap(r=>String(r['关联正文']||'').split('；').filter(Boolean)));
  for(const link of links){
    const path=sourceReferencePath(source,link);
    await readFile(path).catch(()=>{throw new Error('正文回链不存在：'+link);});
  }
  for(const name of referencedEvidenceFiles(rows,{root})){
    const info=await stat(resolve(root,name)).catch(e=>{if(e.code==='ENOENT')throw new Error('证据文件不存在：'+name);throw e;});
    if(!info.isFile())throw new Error('证据引用必须指向文件：'+name);
  }
}
