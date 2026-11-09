import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TABLES,UPDATE_DEFINITIONS,FLIGHT_ARCHIVE_HEADERS,EVIDENCE_HEADERS,MEASUREMENT_HEADERS} from '../scripts/schema.mjs';
import {csv,flightsFromArchive,loadAtlas} from '../scripts/atlas-data.mjs';
import {mergeRows,validateEvidenceDelta,updateAtlas} from '../scripts/update-atlas.mjs';
import {flightView} from '../scripts/flight-view.mjs';
import {transportNodeId} from '../scripts/node-access.mjs';
import {durationSummary} from '../src/transport-time.mjs';
import {prepareReconstruction} from '../scripts/reconstruct-connections.mjs';

const source='50_🌍旅行记录/51_行程/2024/2024-05_航空测试.md';
const flight=(id,date,reverse=false)=>({
  '序号':id==='F1'?'1':'2','证据编号':id,'记录类型':'已飞','日期':date,'日期标准':date,'年份':'2024',
  '航空公司':'原航司','航班号':id,'出发城市':reverse?'乙机场':'甲机场','到达城市':reverse?'甲机场':'乙机场',
  '出发服务城市':reverse?'乙城':'甲城','到达服务城市':reverse?'甲城':'乙城',
  '出发国家地区':'中国','到达国家地区':'中国','纬度_出发':reverse?'31':'30','经度_出发':reverse?'121':'120',
  '纬度_到达':reverse?'30':'31','经度_到达':reverse?'120':'121',
  '里程公里':'1000','统计采用里程公里':'1000','统计里程依据':'航旅纵横导出原值优先',
  '飞行时长分钟':'120','飞行时长依据':'表列当地起降时刻，按机场历史时区与跨日换算；非实际空中时间',
  '航段发生依据':'导出已使用客票','原始来源文件':'保留原导出.xls','原始来源工作表':'原始记录',
  '原始来源行':id==='F1'?'10':'11','原始客票状态':'已使用','关联正文':source,
});
const review=(record='2026-10-11 复核凭证，修正采用数值')=>({
  '核定结论':'已发生','核定方式':'证据复核','证据引用':'正文:'+source,'核定记录':record,
});

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'travel-flight-api-')),folder=join(root,'50_🌍旅行记录/53_整理说明');
  await mkdir(folder,{recursive:true});await mkdir(join(root,'50_🌍旅行记录/51_行程/2024'),{recursive:true});
  await writeFile(join(root,source),'隔离测试凭证。\n');
  const rows=[flight('F1','2024-05-01'),flight('F2','2024-05-02',true)];
  for(const def of Object.values(UPDATE_DEFINITIONS))if(!def.optional){
    const values=def.file===TABLES.flightArchive?rows:def.file===TABLES.journeys?[{
      '行程编号':'J-TEST','行程名称':'机场往返','出发基地':'甲机场','日期或区间':'2024-05-01 — 2024-05-02',
      '重构状态':'来源归组','行程依据':'两张原始客票','关联交通编号':'F1；F2','关联正文':source,'分享纳入':'纳入',
    }]:[];
    await writeFile(join(folder,def.file),csv(values,def.headers));
  }
  // A wildly different legacy snapshot must not affect current atlas loading.
  await writeFile(join(folder,'travel.json'),JSON.stringify({meta:{totalKm:99999999},flights:[{id:'OLD'}]}));
  return {root,folder,rows,dispose:()=>rm(root,{recursive:true,force:true})};
}

test('审核航段更新合同按证据编号保留全部原航空字段',()=>{
  const def=UPDATE_DEFINITIONS.flightArchive;
  assert.equal(def.file,TABLES.flightArchive);assert.equal(def.id,'证据编号');
  assert.equal(new Set(FLIGHT_ARCHIVE_HEADERS).size,FLIGHT_ARCHIVE_HEADERS.length);
  assert.equal(FLIGHT_ARCHIVE_HEADERS.length,53+EVIDENCE_HEADERS.length+MEASUREMENT_HEADERS.length);
  const old=flight('F1','2024-05-01'),next=mergeRows([old],[{'证据编号':'F1','统计采用里程公里':1500,...review()}],def.id,def.headers).rows[0];
  assert.equal(next['里程公里'],'1000');assert.equal(next['原始来源文件'],'保留原导出.xls');
  assert.equal(next['原始客票状态'],'已使用');assert.equal(next['原始来源行'],'10');
});

test('航空事实新增及修订必须有新核定，不借旧核定或历史迁移改事实',()=>{
  const old={...flight('F1','2024-05-01'),...review('原核定记录')};
  assert.throws(()=>validateEvidenceDelta([old],[{...old,'飞行时长分钟':'180'}],'flightArchive'),/须更新核定记录/);
  assert.throws(()=>validateEvidenceDelta([], [{...flight('NEW','2024-05-01'),...review(),'核定方式':'历史迁移'}], 'flightArchive',{migration:true}),/新记录或晋级不能/);
  assert.throws(()=>validateEvidenceDelta([flight('F1','2024-05-01')],[{...flight('F1','2024-05-01'),'统计采用里程公里':'1500'}],'flightArchive'),/核定不完整/);
  assert.doesNotThrow(()=>validateEvidenceDelta([old],[{...old,'飞行时长分钟':'180',...review('新核定记录')}],'flightArchive'));
  const typed={...old,'里程类型':'archived','时长类型':'model','线形类型':'display','计程纳入':'是'};
  assert.throws(()=>validateEvidenceDelta([typed],[{...typed,'时长类型':'observed'}],'flightArchive'),/须更新核定记录/);
});

test('航空兼容读取依据数值来源保留精度，已飞不证明实测路径或时长',()=>{
  const archived=flightsFromArchive([flight('F1','2024-05-01')])[0];
  assert.equal(archived.distanceType,'archived');assert.equal(archived.durationType,'archived');assert.equal(archived.geometryType,'display');
  const inferred=flightsFromArchive([{...flight('F1','2024-05-01'),
    '统计里程依据':'无导出值；采用公开机场对参考距离，路线/机场/日期仍为补录证据精度',
    '飞行时长依据':'已记录航班的里程—时长线性模型估算'}])[0];
  assert.equal(inferred.distanceType,'reference');assert.equal(inferred.durationType,'model');
  const unknown=flightsFromArchive([{...flight('F1','2024-05-01'),'统计里程依据':'尚未分类原资料','飞行时长依据':'尚未分类原时长'}])[0];
  assert.equal(unknown.distanceType,'unknown');assert.equal(unknown.durationType,'unknown');
  assert.equal(unknown.evidence,'导出已使用客票');assert.equal(unknown.minutes,120);assert.equal(unknown.km,1000);
});

test('冲突票务钟点只退出时刻匹配，保留原始字段、日期、路线和独立时长模型',()=>{
  const raw={...flight('F1','2024-05-01'),'出发时间':'14:50','到达时间':'17:00','出发时区':'Europe/Helsinki','到达时区':'Europe/Stockholm'};
  assert.ok(Number.isFinite(flightsFromArchive([raw])[0].scheduledStart));
  const row={...raw,'时刻使用策略':'仅日期','飞行时长分钟':'75'};
  const result=flightsFromArchive([row])[0];
  assert.equal(result.scheduledStart,null);assert.equal(result.scheduledEnd,null);
  assert.equal(result.date,'2024-05-01');assert.equal(result.minutes,75);
  assert.equal(row['出发时间'],'14:50');assert.equal(row['到达时间'],'17:00');
  assert.throws(()=>flightsFromArchive([{...raw,'时刻使用策略':'猜测时间'}]),/使用策略无效/);
});

test('接续预览同时应用航空源撤回，不为已排除票务制造反向补飞',async()=>{
  const f=await fixture();
  try{
    const second={...f.rows[1],'出发城市':'丙机场','纬度_出发':'32','经度_出发':'122'};
    await writeFile(join(f.folder,TABLES.flightArchive),csv([f.rows[0],second],FLIGHT_ARCHIVE_HEADERS));
    await writeFile(join(f.folder,TABLES.visits),csv([],UPDATE_DEFINITIONS.visits.headers));
    const before=await prepareReconstruction({vault:f.root});
    assert.ok(before.review.decisions.some(d=>d.category==='reconstructed'));
    const after=await prepareReconstruction({vault:f.root,sourcePatch:{flightArchive:[{'证据编号':'F1',...review('本人确认该同向票未另行执行'),'核定结论':'排除'}]}});
    assert.equal(after.review.decisions.length,0);
  }finally{await f.dispose();}
});

test('当前更新入口的单航段修订同步所有飞行统计，legacy snapshot不参与',async t=>{
  t.mock.method(console,'log',()=>{});
  const f=await fixture();
  try{
    const loaded=await loadAtlas(f.root),patch={version:1,flightArchive:[{
      '证据编号':'F1','统计采用里程公里':1500,'飞行时长分钟':180,'航空公司':'新航司',...review(),
    }]},input=join(f.root,'update.json');
    await writeFile(input,JSON.stringify(patch));
    const report=await updateAtlas({vault:f.root,input,dryRun:true});
    assert.equal(report.changes.flightArchive.updated,1);assert.equal(report.after.totalKm,2500);
    assert.equal(report.after.flightKm,2500);assert.equal(report.after.flightMinutes,300);
    assert.equal(report.regions.china.flightKm,2500);
    assert.equal(report.changes.visits.updated,1);
    const merged=mergeRows(loaded.sourceRows.flightArchive,patch.flightArchive,'证据编号',FLIGHT_ARCHIVE_HEADERS).rows;
    const after=await loadAtlas(f.root,{flightArchive:merged}),data=flightView(after.atlas);
    assert.equal(data.meta.totalKm,2500);assert.equal(data.meta.totalMinutes,300);assert.equal(data.meta.airlines,2);
    assert.equal(data.meta.flightCount,2);assert.equal(data.meta.plannedCount,0);
    assert.ok(data.flights.every(r=>r.kind==='used'));
    assert.equal(after.atlas.byMode['飞机'].km,2500);assert.equal(after.sourceRows.flightArchive[0]['里程公里'],'1000');
    assert.equal(after.sourceRows.flightArchive[0]['原始来源文件'],'保留原导出.xls');
    const reread=await loadAtlas(f.root);assert.equal(reread.atlas.meta.totalKm,2000);
    assert.equal(JSON.parse(await readFile(join(f.folder,'travel.json'),'utf8')).meta.totalKm,99999999);
  }finally{await f.dispose();}
});

test('航空更新沿用实际行程日期与端点接续校验，失败不写入源表',async t=>{
  t.mock.method(console,'log',()=>{});
  const f=await fixture();
  try{
    const path=join(f.folder,TABLES.flightArchive),original=await readFile(path,'utf8'),input=join(f.root,'invalid.json');
    await writeFile(input,JSON.stringify({version:1,flightArchive:[{
      '证据编号':'F1','日期标准':'2024-06-01',...review('新日期核定'),
    }]}));
    await assert.rejects(updateAtlas({vault:f.root,input,dryRun:true}),/交通日期超出行程范围/);
    await writeFile(input,JSON.stringify({version:1,flightArchive:[{
      '证据编号':'F1','纬度_到达':'32',...review('新端点核定'),
    }]}));
    await assert.rejects(updateAtlas({vault:f.root,input,dryRun:true}),/新增未接续节点\/移动或结构矛盾/);
    assert.equal(await readFile(path,'utf8'),original);
  }finally{await f.dispose();}
});

test('合法补充航空patch只填交通时长也同步当前atlas、飞行卡与动态累计',async t=>{
  t.mock.method(console,'log',()=>{});
  const f=await fixture();
  try{
    const ground=(id,date,reverse=false)=>{
      const points=reverse?[[31,121],[30,120]]:[[30,120],[31,121]],names=reverse?['乙机场','甲机场']:['甲机场','乙机场'];
      return {'交通编号':id,'日期或区间':date,'交通方式':'飞机','途经节点':names.join('；'),
        '坐标序列纬经':JSON.stringify(points),'节点编号序列':names.map((name,i)=>transportNodeId(name,points[i],'中国')).join('；'),
        '国家地区':'中国','里程公里':'675','里程依据':'隔离测试公里模型','发生状态':'合理推定','发生依据':'隔离测试凭证',
        '关联正文':source,'分享纳入':'纳入','记录类型':'旅行航段','交通时长分钟':'90','交通时长依据':'隔离测试已核时长模型',
        '里程类型':'model','时长类型':'model','线形类型':'display','计程纳入':'是',...review(),'核定结论':'合理重构'};
    };
    const patch={version:1,ground:[ground('GT-F3','2024-05-03'),ground('GT-F4','2024-05-04',true)],
      journeys:[{'行程编号':'J-TEST','日期或区间':'2024-05-01 — 2024-05-04','关联交通编号':'F1；F2；GT-F3；GT-F4'}]},input=join(f.root,'supplementary.json');
    await writeFile(input,JSON.stringify(patch));
    const report=await updateAtlas({vault:f.root,input,dryRun:true});
    assert.equal(report.after.flightMinutes,420);
    const before=await loadAtlas(f.root),journeys=mergeRows(before.sourceRows.journeys,patch.journeys,'行程编号',UPDATE_DEFINITIONS.journeys.headers).rows;
    const after=await loadAtlas(f.root,{ground:patch.ground,journeys});
    assert.equal(after.atlas.meta.flightMinutes,420);assert.equal(flightView(after.atlas).meta.totalMinutes,420);
    assert.equal(durationSummary(after.atlas.routes).modes.find(m=>m.mode==='飞机').minutes,420);
    assert.equal(after.atlas.routes.find(r=>r.id==='GT-F3').durationType,'model');
    assert.equal(after.sourceRows.ground[0]['飞行时长分钟'],undefined);
  }finally{await f.dispose();}
});
