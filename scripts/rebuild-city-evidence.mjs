import {readAtlasConfig,resolveSource,sourcePath} from './source-data.mjs';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {ROOT,readJson,WORKSPACE_ROOT} from './data.mjs';
import {collectCitiesEvidence,cityEvidenceRecord} from './city-evidence.mjs';
import {updateAtlas} from './update-atlas.mjs';
import {TABLES} from './schema.mjs';

// Catalogue-driven city evidence refresh. One source scan feeds any number of
// cities; activity curation remains separate from the complete evidence layer.
const {values}=parseArgs({options:{sources:{type:'string'},vault:{type:'string'},cities:{type:'string'},output:{type:'string'},cache:{type:'string'},apply:{type:'boolean',default:false},help:{type:'boolean',default:false}}});
if(values.help) { console.log('用法：node scripts/rebuild-city-evidence.mjs --sources inputs/私有来源配置.json [--cities tokyo,guangzhou] [--apply]'); process.exit(0); }
const config=await readAtlasConfig(),sourcesPath=resolve(values.sources||join(WORKSPACE_ROOT,'inputs/city-sources.json')),sources=JSON.parse(await readFile(sourcesPath,'utf8'));
const source=await resolveSource({vault:values.vault,config});
const catalog=await readJson(join(ROOT,'data/city-catalog.json')),ids=values.cities?.split(',').filter(Boolean);
const selected=catalog.filter(c=>!c.deriveFrom&&!c.useGlobal&&(!ids||ids.includes(c.id)));
if(!selected.length)throw new Error('没有选中可维护城市；请检查 --cities 或城市目录');
const snapshots={};for(const [key,path]of Object.entries(sources)){const s=await stat(path);snapshots[key]={path,size:s.size,mtime:s.mtime.toISOString()};}
const cities=await Promise.all(selected.map(async c=>({id:c.id,timeZone:c.timeZone,geometry:JSON.parse(await readFile(join(ROOT,'data',c.boundaryFile),'utf8'))})));
const raw=await collectCitiesEvidence({...sources,cities});
const journeys=JSON.parse(await readFile(sourcePath(source,TABLES.cityJourneys)));
const evidence=Object.fromEntries(selected.map(c=>{const record=cityEvidenceRecord(raw[c.id],journeys.filter(j=>j.cityId===c.id),c.timeZone);return [c.id,{...record,source:{...sources,timeZone:c.timeZone,sourceSnapshots:snapshots}}];}));
const output=resolve(values.output||join(WORKSPACE_ROOT,'inputs/城市完整定位证据.json'));await mkdir(join(output,'..'),{recursive:true});
await writeFile(output,JSON.stringify({version:1,cityEvidence:evidence},null,2)+'\n');
const summary=Object.fromEntries(selected.map(c=>[c.id,evidence[c.id].summary]));
console.log(JSON.stringify({output,cities:selected.map(c=>c.id),summary,dryRun:!values.apply},null,2));
if(values.apply){
  for(const [key,snapshot]of Object.entries(snapshots)){const current=await stat(snapshot.path);if(current.size!==snapshot.size||current.mtime.toISOString()!==snapshot.mtime)throw new Error('原输入在扫描后发生变化，停止写入：'+key);}
  await updateAtlas({input:output,vault:values.vault,noRender:true});
}
