import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlaceholderPatches} from '../scripts/infer-placeholders.mjs';
import {inferLinks,privatePatchOutput} from '../scripts/infer-links.mjs';

const evidence={核定结论:'合理重构',核定方式:'历史迁移',证据引用:'正文:旅程.md',核定记录:'沿用既有已登记移动'};
const row=(id,extra={})=>({交通编号:id,交通方式:'公路',记录类型:'旅行航段',发生状态:'合理推定',发生依据:'既有明确维护交通',
  关联正文:'旅程.md',分享纳入:'纳入',计程纳入:'是',里程公里:'',...evidence,...extra});
const route=(id,extra={})=>({id,mode:'公路',recordType:'旅行航段',status:'合理推定',include:true,countDistance:true,
  km:null,points:[[1,1],[1,1.01]],...extra});
const build=(rows,routes)=>buildPlaceholderPatches({atlas:{routes},sourceRows:{ground:rows}});

test('只核缺失里程模型，不改变发生状态、方式、日期或几何',()=>{
  const before=row('R1'),{ground}=build([before],[route('R1')]);assert.equal(ground.length,1);
  const patch=ground[0];assert.equal(patch['里程类型'],'model');assert.equal(patch['核定结论'],'合理重构');
  assert.equal(patch['核定方式'],'证据复核');assert.notEqual(patch['证据引用'],before['证据引用']);
  assert.notEqual(patch['核定记录'],before['核定记录']);
  for(const key of ['交通方式','发生状态','日期或区间','开始日期','结束日期','路线几何经纬','线形类型'])assert.equal(key in patch,false);
  assert.match(patch['核定记录'],/不新增事实确认/);assert.equal(before['里程公里'],'');
});

test('待核/未知LINK、资料间隔和显式不计程均不补公里',()=>{
  const rows=[row('LINK',{记录类型:'接驳段',发生状态:'待还原',核定结论:'待核',计程纳入:'否'}),
    row('GAP',{记录类型:'资料间隔'}),row('SKIP',{计程纳入:'否'}),row('PENDING',{核定结论:'待核'})];
  const routes=[route('LINK',{recordType:'接驳段',structuralLink:true,countDistance:false}),route('GAP',{recordType:'资料间隔'}),
    route('SKIP',{countDistance:false}),route('PENDING')];
  const out=build(rows,routes);assert.deepEqual(out.ground,[]);assert.equal(out.excluded.length,4);
});

test('不从铁路/景区关键词、环线名称、个人编号推断方式或量级',()=>{
  const rows=[row('UNKNOWN',{交通方式:'地面交通待定',发生依据:'景区、铁路车站和游船线索'}),row('LOOP',{途经节点:'景区环线'})];
  const routes=[route('UNKNOWN',{mode:'地面交通待定'}),route('LOOP',{points:[[1,1],[1,1]]})];
  const out=build(rows,routes);assert.deepEqual(out.ground,[]);assert.equal(out.skipped.length,2);
  assert.match(out.skipped[0].reason,/不能从地名、正文关键词/);assert.match(out.skipped[1].reason,/同点环线/);
});

test('极近但明确登记的不同端点使用计算精度，不人为设置1公里下限',()=>{
  const out=build([row('TINY')],[route('TINY',{points:[[1,1],[1,1.0001]]})]);
  const km=out.ground[0]['里程公里'];assert.ok(km>0&&km<0.1);assert.notEqual(km,1);
});

test('既有数值和既有距离模型不被未来补齐入口撤回或重写',()=>{
  const out=build([row('VALUE',{里程公里:15}),row('MODEL',{距离模型:'road'})],
    [route('VALUE',{km:15}),route('MODEL',{km:20,distanceModel:'road'})]);
  assert.deepEqual(out.ground,[]);assert.equal(out.meta.before,0);
});

test('连接入口输出精确待还原边，不猜同国铁路或长途航空',async()=>{
  const routes=[{...route('R1'),names:['甲','乙'],nodeIds:['A','B'],points:[[1,1],[2,2]],date:'2020-01-01',countries:['甲国'],source:'旅程.md'},
    {...route('R2'),names:['丙','丁'],nodeIds:['C','D'],points:[[40,100],[41,101]],date:'2020-01-02',countries:['乙国'],source:'旅程.md'}];
  const out=await inferLinks({atlas:{routes,locationLayer:{places:[]},journeyLayer:{journeys:[]}}});
  assert.equal(out.ground.length,1);assert.deepEqual(out.journeys,[]);const patch=out.ground[0];
  assert.equal(patch['交通方式'],'交通方式待定');assert.equal(patch['发生状态'],'待还原');assert.equal(patch['计程纳入'],'否');
  assert.equal(patch['里程公里'],'');assert.equal(patch['距离模型'],'');assert.equal(patch['前序路线段'],1);
  assert.equal(patch['后序路线段'],1);assert.equal(patch['核定结论'],'待核');assert.match(patch['证据引用'],/表行:/);
});

test('补丁输出局限repo私有目录，保留output/write路径能力但拒绝直接写正式源',()=>{
  const root='/tmp/test-travel-repo';
  assert.equal(privatePatchOutput(undefined,'patch.json',{root}),root+'/inputs/patch.json');
  assert.equal(privatePatchOutput(root+'/private/patch.json','default.json',{root}),root+'/private/patch.json');
  assert.throws(()=>privatePatchOutput('/tmp/vault/source.csv','patch.json',{root}),/Git 忽略目录/);
  assert.throws(()=>privatePatchOutput(root+'/inputs/../../source.json','patch.json',{root}),/Git 忽略目录/);
});
