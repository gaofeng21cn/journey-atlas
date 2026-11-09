import {readAtlasConfig,resolveSource,sourcePath} from './source-data.mjs';
import {readFile,readdir,stat,writeFile,mkdir,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import yauzl from 'yauzl';
import tzLookup from 'tz-lookup';
import {finishCityEvidence,cityDate} from './city-evidence.mjs';
import {ROOT,readJson} from './data.mjs';
import {maintainHistory} from './prune-history.mjs';

export const GLOBAL_EVIDENCE_FILE='全旅程数据点-定位证据.json';
const valid=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
export function locationTimeZone(lat,lon){return tzLookup(lat,lon);}

// Read selected entries by their ZIP metadata, including ZIP64 and Unicode
// paths. Encrypted device backups are inventoried, never guessed/decrypted.
export async function readGoogleLocations(folder){
  const points=[],inventory=[];
  if(!folder)return {points,inventory};
  for(const name of (await readdir(folder)).filter(n=>n.endsWith('.zip')).sort()){
    const path=join(folder,name);let selected=0,encrypted=0;
    await new Promise((ok,fail)=>yauzl.open(path,{lazyEntries:true,autoClose:true},(error,zip)=>{
      if(error)return fail(error);zip.on('error',fail);zip.on('end',ok);
      zip.on('entry',entry=>{
        if(/encrypted|加密/i.test(entry.fileName))encrypted++;
        if(!/(?:Semantic Location History\/.*|(?:^|\/)(?:Records|Locations|location-history|timeline))\.json$/i.test(entry.fileName)){zip.readEntry();return;}
        if(entry.generalPurposeBitFlag&1){encrypted++;zip.readEntry();return;}
        zip.openReadStream(entry,(error,stream)=>{
          if(error)return fail(error);const chunks=[];let size=0;
          stream.on('data',b=>{size+=b.length;if(size>64*1024*1024){stream.destroy(new Error('Google定位单个JSON超过64MB，需流式导入'));return;}chunks.push(b);});stream.on('error',fail);
          stream.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));selected++;
            const emit=(p,time,suffix)=>{const lat=p?.latitudeE7!==undefined?p.latitudeE7/1e7:p?.latitude,lon=p?.longitudeE7!==undefined?p.longitudeE7/1e7:p?.longitude;
              const seconds=typeof time==='number'?time>1e12?time/1000:time:Date.parse(time)/1000;
              if(valid(lat,lon)&&Number.isFinite(seconds)&&seconds>0)points.push({uuid:'google:'+name+':'+entry.fileName+':'+suffix,time:seconds,lat,lon,sourceKind:'google'});};
            for(const [i,p]of (data.locations||[]).entries())emit(p,p.timestamp||Number(p.timestampMs),'location:'+i);
            for(const [i,obj]of (data.timelineObjects||[]).entries()){
              const p=obj.placeVisit,a=obj.activitySegment;
              if(p){emit(p.location,p.duration?.startTimestamp||Number(p.duration?.startTimestampMs),'visit:'+i+':start');emit(p.location,p.duration?.endTimestamp||Number(p.duration?.endTimestampMs),'visit:'+i+':end');}
              if(a){emit(a.startLocation,a.duration?.startTimestamp||Number(a.duration?.startTimestampMs),'move:'+i+':start');emit(a.endLocation,a.duration?.endTimestamp||Number(a.duration?.endTimestampMs),'move:'+i+':end');
                for(const [j,p]of (a.simplifiedRawPath?.points||[]).entries())emit(p,p.timestamp||Number(p.timestampMs),'path:'+i+':'+j);}
            }
            zip.readEntry();
          }catch(e){fail(e);}});
        });
      });zip.readEntry();
    }));
    inventory.push({name,readableJson:selected,encryptedEntries:encrypted});
  }
  const unique=[...new Map(points.map(p=>[[p.time,p.lat,p.lon].join('|'),p])).values()];
  return {points:unique,inventory};
}

export async function collectGlobalEvidence({photosPath,footprintPath,googlePath}){
  const points=[],photoPoints=[];let rows=0,poorAccuracy=0,photoImports=0,invalid=0;
  for(const p of JSON.parse(await readFile(photosPath,'utf8'))){
    const time=Date.parse(p.time_utc)/1000;
    if(p.gps_valid&&valid(p.lat,p.lon)&&Number.isFinite(time)&&time>0)photoPoints.push({uuid:p.uuid,time,lat:p.lat,lon:p.lon,date:cityDate(time,locationTimeZone(p.lat,p.lon)),country:p.country||'',city:p.city||'',sourceKind:'photo'});
  }
  let headers;
  for await(const line of createInterface({input:createReadStream(footprintPath),crlfDelay:Infinity})){
    if(!headers){headers=line.replace(/^\uFEFF/,'').split(',');continue;}if(!line.trim())continue;rows++;
    const fields=line.split(','),r=Object.fromEntries(headers.map((h,i)=>[h,fields[i]]));
    const lat=Number(r.latitude),lon=Number(r.longitude),time=Number(r.dataTime),accuracy=Number(r.accuracy);
    if(!valid(lat,lon)||!Number.isFinite(time)||time<=0){invalid++;continue;}
    if(!Number.isFinite(accuracy)||accuracy<0||accuracy>100){poorAccuracy++;continue;}
    if(accuracy===0){photoImports++;continue;}
    points.push({lat,lon,time,accuracy,speed:Number(r.speed)});
  }
  const google=await readGoogleLocations(googlePath);
  const raw=finishCityEvidence({points,photos:[],timeZoneAt:locationTimeZone,poorAccuracy,photoImports,maxSpeed:320},rows);
  for(const p of google.points)photoPoints.push({...p,date:cityDate(p.time,locationTimeZone(p.lat,p.lon))});
  const snapshots={};for(const [kind,path]of Object.entries({photosPath,footprintPath})){const s=await stat(path);snapshots[kind]={path,size:s.size,mtime:s.mtime.toISOString()};}
  return {version:1,summary:{...raw.summary,photos:photoPoints.filter(p=>p.sourceKind==='photo').length,googlePoints:google.points.length,invalid,
    recordedDays:new Set([...raw.tracks.map(t=>t.date),...photoPoints.map(p=>p.date)]).size},tracks:raw.tracks,stays:raw.stays,photoPoints,
    source:{snapshots,googlePath,googleInventory:google.inventory},policy:{scope:'全部移动，包含日常通勤',maxGpsAccuracyMeters:100,maxGroundSpeedKmh:320,rawInputsUnchanged:true}};
}

async function main(){
  const {values}=parseArgs({options:{sources:{type:'string'},vault:{type:'string'},apply:{type:'boolean',default:false}}});
  const config=await readAtlasConfig(),sources=await readJson(resolve(values.sources||join(ROOT,'inputs/global-sources.json')));
  const source=await resolveSource({vault:values.vault,config});
  const evidence=await collectGlobalEvidence(sources),patch=join(ROOT,'inputs/全球完整定位证据.json');await mkdir(join(patch,'..'),{recursive:true});
  await writeFile(patch,JSON.stringify(evidence)+'\n');
  const result={dryRun:!values.apply,patch,summary:evidence.summary,googleInventory:evidence.source.googleInventory};
  if(values.apply){
    const target=sourcePath(source,GLOBAL_EVIDENCE_FILE);
    let original=null;try{original=await readFile(target);}catch(e){if(e.code!=='ENOENT')throw e;}
    const backup=join(ROOT,'data/history',new Date().toISOString().replace(/[:.]/g,'-')+'-global-observations');await mkdir(backup,{recursive:true});
    if(original)await writeFile(join(backup,GLOBAL_EVIDENCE_FILE),original);
    for(const s of Object.values(evidence.source.snapshots)){const current=await stat(s.path);if(current.size!==s.size||current.mtime.toISOString()!==s.mtime)throw new Error('扫描期间来源已变化，停止写入');}
    const current=await readFile(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(original?!current?.equals(original):current!==null)throw new Error('全局观测源已被并发修改');
    const tmp=target+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(evidence)+'\n');await rename(tmp,target);
    result.target=target;result.backup=backup;
    await maintainHistory();
  }
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
