// 预览真实前后交通之间未管理的接续。这里只登记待还原结构关系，
// 不猜交通方式、不计程，也不把连接候选当成新的旅游事实。
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {parseArgs} from 'node:util';
import {ROOT} from './data.mjs';
import {loadAtlas} from './atlas-data.mjs';
import {buildManagedLinkRows} from './managed-links.mjs';

export function privatePatchOutput(requested,defaultName,{root=ROOT}={}){
  const out=requested?resolve(requested):join(root,'inputs',defaultName);
  const isPrivate=['inputs','private'].some(folder=>{
    const rel=relative(join(root,folder),out);
    return rel!==''&&rel!=='..'&&!rel.startsWith('../')&&!isAbsolute(rel);
  });
  if(!isPrivate)throw new Error('补丁输出必须位于 app repo 的 Git 忽略目录 inputs/ 或 private/，不能直接写正式维护源');
  if(!out.endsWith('.json'))throw new Error('维护补丁输出须使用 .json 文件名');
  return out;
}

export async function inferLinks({atlas}={}){
  const loaded=atlas?{atlas}:await loadAtlas();
  const result=buildManagedLinkRows(loaded.atlas);
  // 未还原连接通过精确的前后交通段绑定接续，不插入某一行程的事实
  // 航段清单；跨行程的结构关系也不会被强塞进一侧行程。
  return {ground:result.rows,journeys:[],skipped:result.issues,summary:result.summary};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{output:{type:'string'},write:{type:'boolean',default:false}}});
  const {ground,journeys,skipped,summary}=await inferLinks();
  console.log(`未管理接续 ${summary.connections} 条；资料间隔 ${summary.recordIntervals} 条；需修复引用/时间 ${skipped.length} 条。全部待还原，不计入里程和时长。`);
  for(const g of ground.slice(0,10))console.log(`  + ${g['交通编号']} | ${g['记录类型']} | ${g['前序交通编号']}#${g['前序路线段']} → ${g['后序交通编号']}#${g['后序路线段']}`);
  if(ground.length>10)console.log(`  其余 ${ground.length-10} 条可通过 --write 保存到私有补丁。`);
  for(const issue of skipped.slice(0,10))console.log(`  待修复：${issue.previousTransport} → ${issue.nextTransport} | ${issue.message}`);
  if(values.write||values.output){
    const out=privatePatchOutput(values.output,'placeholder-links.json');
    await mkdir(dirname(out),{recursive:true});
    await writeFile(out,JSON.stringify({version:1,ground,journeys},null,2)+'\n');
    console.log('已写私有连接补丁：'+out+'；正式维护源未改变。');
  }else console.log('（预览模式；加 --write 或 --output inputs/文件名.json 生成私有补丁）');
}
