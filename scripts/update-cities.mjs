import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseCsv,csv,loadAtlas} from './atlas-data.mjs';
import {mergeRows,validateEvidenceDelta} from './update-atlas.mjs';
import {validateLinks} from './source-references.mjs';
import {loadCityDetails,CITY_FILES} from './city-data.mjs';
import {CITY_PLACE_HEADERS,CITY_MOVE_HEADERS} from './schema.mjs';
import {applySourceUpdate,updateSourceSnapshot} from './update-operation.mjs';
import {sourcePath} from './source-data.mjs';

// One validated, recoverable transaction for the four city-maintenance files.
export async function updateCities({patch,vault,source,dryRun=false,snapshot,operationId,inputRef,output}){
  const allowed=['version','schemaMigration','cityPlaces','cityMoves','cityJourneys','cityEvidence'];
  if(patch.version!==1||Object.keys(patch).some(k=>!allowed.includes(k)))throw new Error('城市批次仅接受地点、移动、行程与定位证据');
  if(patch.schemaMigration!==undefined&&patch.schemaMigration!==8)throw new Error('仅允许本轮证据合同迁移版本8');
  if(patch.cityEvidence&&(typeof patch.cityEvidence!=='object'||Array.isArray(patch.cityEvidence)))throw new Error('cityEvidence须按城市编号组织');
  const loaded=await loadAtlas(vault,{}, {source}),{folder,atlas}=loaded;
  source=loaded.source;
  snapshot??=await updateSourceSnapshot(folder,source);
  const original=await Promise.all(CITY_FILES.map(n=>readFile(sourcePath(source||{type:'obsidian',folder},n),'utf8')));
  const originalPlaces=parseCsv(original[0]),originalMoves=parseCsv(original[1]);
  const places=mergeRows(originalPlaces,patch.cityPlaces||[],'地点编号',CITY_PLACE_HEADERS);
  const moves=mergeRows(originalMoves,patch.cityMoves||[],'移动编号',CITY_MOVE_HEADERS);
  validateEvidenceDelta(originalPlaces,places.rows,'cityPlaces',{migration:patch.schemaMigration===8});
  validateEvidenceDelta(originalMoves,moves.rows,'cityMoves',{migration:patch.schemaMigration===8});
  const trips=new Map(JSON.parse(original[2]).map(t=>[t.id,t]));
  if(patch.cityJourneys&&!Array.isArray(patch.cityJourneys))throw new Error('cityJourneys须为数组');
  const ids=new Set();for(const t of patch.cityJourneys||[]){
    if(!t.id||ids.has(t.id)||!t.cityId||!/^\d{4}-\d{2}-\d{2}$/.test(t.first)||!/^\d{4}-\d{2}-\d{2}$/.test(t.last)||t.first>t.last||!t.source)throw new Error('城市行程身份、日期或来源无效');
    ids.add(t.id);trips.set(t.id,{...trips.get(t.id),...t});
  }
  const evidence={...JSON.parse(original[3]),...patch.cityEvidence};
  const overrides={cityPlaces:places.rows,cityMoves:moves.rows,cityJourneys:[...trips.values()],cityEvidence:evidence};
  const detail=await loadCityDetails(folder,atlas,overrides,source);
  await validateLinks(loaded.vault,[...places.rows,...moves.rows,...[...trips.values()].map(t=>({'关联正文':t.source}))],{source});
  const next=[csv(places.rows,CITY_PLACE_HEADERS),csv(moves.rows,CITY_MOVE_HEADERS),JSON.stringify([...trips.values()],null,2)+'\n',JSON.stringify(evidence,null,2)+'\n'];
  const changed=next.map((s,i)=>s===original[i]?-1:i).filter(i=>i>=0);
  const report={dryRun,input:inputRef,output,placeChanges:places.changes,moveChanges:moves.changes,changedFiles:changed.map(i=>CITY_FILES[i]),...detail.report};
  return applySourceUpdate({folder,source,snapshot,changes:changed.map(i=>({file:CITY_FILES[i],original:original[i],next:next[i]})),report,dryRun,operationId,kind:'cities'});
}
