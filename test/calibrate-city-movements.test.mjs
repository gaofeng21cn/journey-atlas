import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrateCityRows} from '../scripts/calibrate-city-movements.mjs';
import {mergeRows,validateEvidenceDelta} from '../scripts/update-atlas.mjs';
import {CITY_MOVE_HEADERS} from '../scripts/schema.mjs';

const date='2030-04-10',start=Date.parse(date+'T01:00:00Z')/1000;
const config={id:'sample',timeZone:'Asia/Tokyo'};
const places=[{'地点编号':'A','地点名称':'甲地','代表纬度':30.00,'代表经度':20.00,'节点级别':'景区/街区'},
  {'地点编号':'B','地点名称':'乙地','代表纬度':30.00,'代表经度':20.0211,'节点级别':'景区/街区'},
  {'地点编号':'X','地点名称':'区域代表点','代表纬度':30.00,'代表经度':20.00,'节点级别':'区域接续'}];
const row=(id,from,to,order)=>({'移动编号':id,'行程编号':'T','日期':date,'段序':order,'出发地点编号':from,'到达地点编号':to,'里程公里':'3','交通时长分钟':'15','交通方式':'市内交通','发生依据':'原活动次序已核','关联正文':'正文.md'});
const track={id:'GPS1',date,timeZone:'Asia/Tokyo',start,end:start+600,points:[[20.00,30.00],[20.01055,30.00],[20.0211,30.00]],sampleTimes:[start,start+300,start+600],sampleAccuracies:[5,7,5],sampleCumulativeKm:[0,1.1,2.2],samples:3};

test('城市GPS校准保持原端点方式，用同一实测窗口计量，不重复使用同日GPS',()=>{
  const result=calibrateCityRows({config,places,evidence:{tracks:[track]},rows:[row('M1','A','B',1),row('M2','B','A',2),row('M3','A','B',3)]});
  assert.equal(result.review.matched,1);assert.equal(result.patches[0]['里程公里'],2.2);assert.equal(result.patches[0]['交通时长分钟'],10);
  assert.equal(result.patches[0]['核定结论'],'已发生');assert.equal(result.patches[0]['核定方式'],'证据复核');
  assert.equal(result.patches[1]['里程类型'],'model');assert.equal(result.patches[2]['里程类型'],'model');
  assert.ok(result.patches.every(p=>!Object.hasOwn(p,'交通方式')&&!Object.hasOwn(p,'出发地点编号')));
});

test('粗区域接续撤回代表点计量并记录结构复核，不声称重看照片或提升活动事实',()=>{
  const result=calibrateCityRows({config,places,evidence:{tracks:[track]},rows:[row('M1','X','B',1)],reviewReference:'校准回执.json'}),p=result.patches[0];
  assert.equal(p['里程公里'],'');assert.equal(p['交通时长分钟'],'');assert.equal(p['计程纳入'],'否');assert.equal(p['线形类型'],'unknown');
  assert.equal(p['核定方式'],'证据复核');assert.equal(p['核定结论'],'合理重构');assert.match(p['核定记录'],/未重新核看活动原件/);assert.match(p['证据引用'],/校准回执/);
});

test('未匹配GPS时修改几何依据也必须有新的结构复核，不能沿用历史或本人核定记录',()=>{
  for(const method of ['历史迁移','本人确认','证据复核']){
    const old={...row('M1','A','B',1),'核定结论':'合理重构','核定方式':method,'核定记录':'旧活动核定记录','证据引用':'正文.md#实际活动','里程依据':'模型','时长依据':'模型','路线几何依据':'旧路线说明'};
    const result=calibrateCityRows({config,places,evidence:{tracks:[]},rows:[old]}),patch=result.patches[0];
    assert.equal(patch['核定方式'],'证据复核');assert.notEqual(patch['核定记录'],old['核定记录']);assert.match(patch['核定记录'],/未重新核定活动内容/);
    const merged=mergeRows([old],[patch],'移动编号',CITY_MOVE_HEADERS);assert.doesNotThrow(()=>validateEvidenceDelta([old],merged.rows,'cityMoves',{migration:true}));
  }
});
