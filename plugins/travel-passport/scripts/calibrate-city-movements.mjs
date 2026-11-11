import {readAtlasConfig,resolveSource,sourcePath} from './source-data.mjs';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,readJson,WORKSPACE_ROOT} from './data.mjs';
import {parseCsv} from './csv.mjs';
import {CITY_FILES} from './city-data.mjs';
import {collectCityEvidence,matchObservedPath,cityEvidenceRecord} from './city-evidence.mjs';
import {SCHEMA_VERSION,EVIDENCE_HEADERS} from './schema.mjs';

const metadataFields=new Set([...EVIDENCE_HEADERS,'里程类型','时长类型','线形类型']);
function changesOccurrenceOrRepresentation(row,patch){
  return Object.entries(patch).some(([key,value])=>{
    if(key==='移动编号'||metadataFields.has(key)||String(row[key]??'')===String(value??''))return false;
    if(key==='计程纳入'&&!row[key]&&value==='是')return false;
    if(key==='记录类型'&&!row[key]&&value==='活动移动')return false;
    return true;
  });
}

// Read-only calibration of already curated city edges. It never promotes a
// place or constructs a route; writing the prepared patch uses the normal
// maintenance entry point and its source review, backup and validation.
export function calibrateCityRows({config,rows,places,evidence,reviewReference='城市定位校准回执'}){
  const index=new Map(places.map(p=>[p['地点编号'],p])),clock=new Map(),patches=[],matches=[],coarse=[],legacyShapes=[];
  for(const row of [...rows].sort((a,b)=>String(a['行程编号']).localeCompare(String(b['行程编号']))||Number(a['段序'])-Number(b['段序']))){
    const id=row['移动编号'],from=index.get(row['出发地点编号']),to=index.get(row['到达地点编号']);
    if(!from||!to)throw new Error('待校准移动引用缺少已有地点：'+id);
    const regional=[from,to].some(p=>p['节点级别']==='区域接续'),date=row['日期'],key=row['行程编号']+'|'+date,after=clock.get(key);
    const observed=regional?null:matchObservedPath(evidence.tracks,date,[+from['代表纬度'],+from['代表经度']],[+to['代表纬度'],+to['代表经度']],{timeZone:config.timeZone,...(after===undefined?{}:{windowStart:after})});
    const source=row['关联正文'],review={
      '核定结论':row['核定结论']||'合理重构','核定方式':row['核定方式']||'历史迁移','证据引用':row['证据引用']||source,
      '核定记录':row['核定记录']||'仅迁移既有核定活动与显式移动次序，不增加到访事实；交通方式及模型数值保留既有依据'};
    const patch={'移动编号':id,'记录类型':regional?'区域接续':row['记录类型']||'活动移动','计程纳入':regional?'否':row['计程纳入']||'是',
      '里程类型':regional?'unknown':row['里程类型']||'model','时长类型':regional?'unknown':row['时长类型']||'model','线形类型':regional?'unknown':'model',
      '路线几何经纬':'','GPS轨迹编号':'','GPS开始时间':'','GPS结束时间':'',...review};
    if(regional){
      Object.assign(patch,{'里程公里':'','交通时长分钟':'','里程依据':'仅记录已核活动的区域接续；具体出发或返回位置未恢复，不计程','时长依据':'具体接续时刻和交通方式未恢复，不计时长','路线几何依据':'区域代表点不是确切移动端点，不生成精确线形',
        '核定结论':'合理重构','核定方式':'证据复核','证据引用':[source,reviewReference+'#'+id].filter(Boolean).join('；'),
        '核定记录':'本次结构复核撤回区域代表点的精确公里、时长及线形；保留既有活动和必要接续，未重新核看活动原件、不新增到访事实'});
      coarse.push(id);
    }else if(observed){
      Object.assign(patch,{'里程公里':observed.km,'交通时长分钟':observed.minutes,'里程类型':'observed','时长类型':'observed','线形类型':'observed',
        '里程依据':'同一连续GPS窗口内原始样本累计距离；不拼接代表点，不叠加全局里程','时长依据':'同一连续GPS窗口结束减开始；保留原始采样时刻，交通方式不据速度自动核定',
        '路线几何经纬':JSON.stringify(observed.points),'路线几何依据':'单个同日连续GPS片段、正确方向、独立端点匹配；起止偏差 '+observed.startDistance.toFixed(3)+'/'+observed.endDistance.toFixed(3)+' 公里；同日显式段序约束',
        'GPS轨迹编号':observed.trackId,'GPS开始时间':observed.start,'GPS结束时间':observed.end,'核定结论':'已发生','核定方式':'证据复核',
        '证据引用':[review['证据引用'],observed.trackId+'@'+observed.start+'-'+observed.end].filter(Boolean).join('；'),
        '核定记录':'既有活动、端点身份及顺序保持；新核对GPS片段只更新线形、里程和时长，不自动核定游览内容或交通方式；窗口 '+observed.trackId+'@'+observed.start+'-'+observed.end+'；里程 '+observed.km+' 公里；时长 '+observed.minutes+' 分钟'});
      clock.set(key,observed.end);
      matches.push({id,date,tripId:row['行程编号'],from:from['地点名称'],to:to['地点名称'],...observed,points:undefined,
        previousKm:Number(row['里程公里']),previousMinutes:Number(row['交通时长分钟']),mode:row['交通方式'],modeReclassified:false});
    }else{
      patch['路线几何依据']='既有核定活动次序的合理连接；新GPS未匹配到可核对的完整同日片段，保留模型公里和时长、只作路线示意';
      if(row['路线几何经纬']){legacyShapes.push(id);Object.assign(patch,{'核定方式':'证据复核','证据引用':[source,reviewReference+'#'+id].filter(Boolean).join('；'),
        '核定记录':'本次定位线形复核未找到同时满足端点方向、精度和时间窗的连续GPS片段；撤回旧几何，保留既有活動顺序与模型数值，不新增到访事实'});}
    }
    if(changesOccurrenceOrRepresentation(row,patch)&&(patch['核定方式']!=='证据复核'||patch['核定记录']===row['核定记录']))Object.assign(patch,{
      '核定方式':'证据复核','证据引用':[review['证据引用'],reviewReference+'#'+id].filter(Boolean).join('；'),
      '核定记录':'本次GPS结构校准：保持既有活动、端点、日期与交通方式；复核移动表达和路线几何依据，未匹配完整GPS的部分保留模型示意；未重新核定活动内容'});
    patches.push(patch);
  }
  return {patches,review:{cityId:config.id,moves:rows.length,matched:matches.length,regionalContinuations:coarse.length,model:rows.length-coarse.length-matches.length,retractedLegacyShapes:legacyShapes,matches,coarse}};
}

async function main(){
  const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
  const sourcesPath=resolve(option('--sources')||join(WORKSPACE_ROOT,'inputs/city-sources.json')),output=resolve(option('--output')||join(WORKSPACE_ROOT,'inputs/city-calibration.json'));
  const cache=resolve(option('--cache')||join(WORKSPACE_ROOT,'private/runtime/city-calibration')),requested=option('--cities')?.split(',');
  const reviewFile=join(WORKSPACE_ROOT,'private/evidence',new Date().toISOString().replace(/[:.]/g,'-')+'-city-calibration.json');
  const sources=await readJson(sourcesPath),settings=await readAtlasConfig(),catalog=await readJson(join(ROOT,'data/city-catalog.json'));
  const source=await resolveSource({vault:option('--vault'),config:settings});
  const sourceSnapshots=Object.fromEntries(await Promise.all(Object.entries(sources).map(async([key,path])=>{const s=await stat(path);return [key,{path,size:s.size,mtime:s.mtime.toISOString()}];})));
  const reuse=args.includes('--reuse-cache');if(reuse){const previous=await readJson(join(cache,'校准回执.json'));if(JSON.stringify(previous.sources)!==JSON.stringify(sourceSnapshots))throw new Error('原输入已变化，须重新采集而不能复用定位缓存');}
  const [placeText,moveText,trips]=await Promise.all([readFile(sourcePath(source,CITY_FILES[0]),'utf8'),readFile(sourcePath(source,CITY_FILES[1]),'utf8'),readJson(sourcePath(source,CITY_FILES[2]))]);
  const places=parseCsv(placeText),rows=parseCsv(moveText),configs=catalog.filter(c=>!c.deriveFrom&&!c.useGlobal&&(!requested||requested.includes(c.id)));
  if(requested&&requested.some(id=>!configs.some(c=>c.id===id)))throw new Error('校准城市必须已登记且由城市源维护');
  await mkdir(cache,{recursive:true});await mkdir(dirname(output),{recursive:true});
  const results=await Promise.all(configs.map(async config=>{
    const geometry=await readJson(join(ROOT,'data',config.boundaryFile)),cacheFile=join(cache,config.id+'-evidence.json');
    const fresh=reuse?await readJson(cacheFile):await collectCityEvidence({...sources,geometry,timeZone:config.timeZone});
    if(!reuse)await writeFile(cacheFile,JSON.stringify(fresh,null,2)+'\n');
    const ownRows=rows.filter(r=>r['城市编号']===config.id),ownPlaces=places.filter(p=>p['城市编号']===config.id),ownTrips=trips.filter(t=>t.cityId===config.id);
    const result=calibrateCityRows({config,rows:ownRows,places:ownPlaces,evidence:fresh,reviewReference:relative(ROOT,reviewFile)});
    console.log(JSON.stringify({cityId:config.id,...fresh.summary,matched:result.review.matched,regionalContinuations:result.review.regionalContinuations}));
    return {...result,evidence:{...cityEvidenceRecord(fresh,ownTrips,config.timeZone),source:{...sources,timeZone:config.timeZone,cacheFile}},summary:fresh.summary};
  }));
  const patch={version:1,schemaMigration:SCHEMA_VERSION,cityMoves:results.flatMap(r=>r.patches),cityEvidence:Object.fromEntries(results.map(r=>[r.review.cityId,r.evidence]))};
  await writeFile(output,JSON.stringify(patch,null,2)+'\n');
  const report={generatedAt:new Date().toISOString(),sources:sourceSnapshots,patch:output,cities:results.map(r=>({...r.review,sourceSummary:r.summary})),principles:['不新增到访点或移动','保持既有端点和显式段序','GPS线形公里时长来自同一窗口','不把GPS速度或机场经过升级为交通方式或游览核定','区域代表锚点不计程']};
  await mkdir(dirname(reviewFile),{recursive:true});
  await writeFile(reviewFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(join(cache,'校准回执.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,moves:patch.cityMoves.length,matched:results.reduce((s,r)=>s+r.review.matched,0),regionalContinuations:results.reduce((s,r)=>s+r.review.regionalContinuations,0)}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
