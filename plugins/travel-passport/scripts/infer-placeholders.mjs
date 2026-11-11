// 仅为已明确维护的实际/合理重构移动估算缺失里程。移动是否发生、
// 日期及交通方式均沿用既有核定；本入口不推断它们，也不填未知连接。
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {loadAtlas} from './atlas-data.mjs';
import {greatCircleKm} from './travel-layers.mjs';
import {validateMovementEvidence,evidenceReferences} from './evidence-contract.mjs';
import {TABLES} from './schema.mjs';
import {privatePatchOutput} from './infer-links.mjs';

const METHOD=Object.freeze({铁路:{key:'rail',factor:1.2},公路:{key:'road',factor:1.25},
  轮渡:{key:'sea',factor:1.05},缆车:{key:'cable',factor:1.05},山地交通:{key:'mountain',factor:1.35},飞机:{key:'great-circle',factor:1}});
const PENDING=new Set(['待核','待还原','计划','原计划','计划航班','待飞','未发生','已取消','取消','排除']);
const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
const refs=x=>[...new Set(x.flatMap(evidenceReferences))].join('；');

export function buildPlaceholderPatches({atlas,sourceRows}){
  const routes=new Map((atlas.routes||[]).map(r=>[r.id,r]));
  const ground=[],skipped=[],excluded=[];let before=0;
  for(const row of sourceRows.ground||[]){
    const id=row['交通编号'],route=routes.get(id);
    // Keep existing source values and already-owned distance models intact.
    if(String(row['里程公里']??'').trim()!==''||(route?.km!==null&&route?.km!==undefined)||row['距离模型'])continue;
    const exclude=reason=>excluded.push({id,reason});
    if(!route||route.include===false||row['分享纳入']==='排除'){exclude('不属于当前纳入的实际/合理重构移动');continue;}
    if(route.countDistance===false||row['计程纳入']==='否'||route.structuralLink||route.candidate||
      route.recordType==='资料间隔'||row['记录类型']==='资料间隔'||PENDING.has(route.status)||PENDING.has(row['发生状态'])){
      exclude('待还原、待核或不计程的结构关系无需补公里');continue;
    }
    const review=validateMovementEvidence(row,{allowHistoricalMigration:true});
    if(!review.ok||!['已发生','合理重构'].includes(review.evidence.conclusion)){
      exclude('没有明确的既有移动核定，不能借公里估算核定发生事实');continue;
    }
    before++;
    const mode=row['交通方式'];
    if(!METHOD[mode]||route.mode!==mode){skipped.push({id,reason:'交通方式未明确维护或与路线不一致；不能从地名、正文关键词或相邻方式猜测'});continue;}
    const points=route.points;
    if(!Array.isArray(points)||points.length<2||!points.every(validPoint)){
      skipped.push({id,reason:'缺少可用的原始路线端点；不能用最低公里数代替证据'});continue;
    }
    const {key,factor}=METHOD[mode];
    const rawKm=points.slice(1).reduce((sum,p,i)=>sum+greatCircleKm(points[i],p),0)*factor;
    const km=Math.round(rawKm*1000)/1000;
    if(!Number.isFinite(km)||km<=0){
      skipped.push({id,reason:'同点环线或端点规模不足，无法推算路线长度；需补显式路径或量级依据'});continue;
    }
    const basis=`模型估算：既有原始路线端点分段大圆距离×${factor}（已维护交通方式：${mode}；模型：${key}）。不是实际线路或票据里程，不核定移动发生、方式、日期或路线形状。`;
    ground.push({'交通编号':id,'里程公里':km,'里程依据':basis,'里程类型':'model',
      '核定结论':review.evidence.conclusion,'核定方式':'证据复核',
      '证据引用':refs([review.evidence.references,`表行:${TABLES.ground}#${id}`,`模型:分段大圆距离*${factor}#${key}`]),
      '核定记录':`本次仅核定缺失里程的模型计算：${points.length-1} 段原始端点、系数 ${factor}、结果 ${km} 公里。发生依据、发生状态、交通方式和时间均沿用原维护记录；数值为模型估算，不新增事实确认。原核定记录：${review.evidence.record}`});
  }
  return {ground,skipped,excluded,meta:{before,planned:ground.length,excluded:excluded.length}};
}

export async function inferPlaceholders({loaded}={}){
  return buildPlaceholderPatches(loaded||await loadAtlas());
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{output:{type:'string'},write:{type:'boolean',default:false}}});
  const {ground,skipped,meta}=await inferPlaceholders();
  console.log(`已核移动缺公里 ${meta.before} 条；可生成模型估算 ${ground.length} 条；缺显式依据 ${skipped.length} 条；不计程/待核等排除 ${meta.excluded} 条。`);
  for(const s of skipped.slice(0,10))console.log('  需补依据：'+s.id+' — '+s.reason);
  if(values.write||values.output){
    const out=privatePatchOutput(values.output,'placeholder-gaps.json');
    await mkdir(dirname(out),{recursive:true});
    await writeFile(out,JSON.stringify({version:1,ground},null,2)+'\n');
    console.log('已写私有里程估算补丁：'+out+'；正式维护源未改变。');
  }else console.log('（预览模式；加 --write 或 --output inputs/文件名.json 生成私有补丁）');
}
