import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlaceEvidence,validateMovementEvidence} from '../scripts/evidence-contract.mjs';
import {promotionDecision} from '../scripts/visit-evidence.mjs';

const decision={'核定结论':'地面到访','核定方式':'证据复核','证据引用':'uuid:photo-1；正文:旅行.md#活动','核定记录':'2030-10-11 复核活动内容与同时段定位，确认该次地面活动'};

test('GPS与客票文字不能替代显式地面到访核定',()=>{
  const row={'到访状态':'已到访','核定依据':'大量GPS和已使用客票','关联正文':'旅行.md'};
  assert.equal(validatePlaceEvidence(row).ok,false);
  assert.equal(validatePlaceEvidence({...row,...decision}).ok,true);
  assert.equal(validatePlaceEvidence({...row,...decision,'核定结论':'交通接触'}).ok,false);
});

test('历史可读兼容保留来源，但不自动声称重新核定或允许新事实迁移',()=>{
  const old={'到访状态':'已到访','核定依据':'历史依据','关联正文':'旅行.md'};
  const read=validatePlaceEvidence(old,{legacy:true});
  assert.equal(read.ok,true);assert.equal(read.evidence.legacy,true);
  assert.equal(read.evidence.method,'历史迁移');
  assert.equal(validatePlaceEvidence({...old,...decision,'核定方式':'历史迁移'}).ok,false);
  assert.equal(validatePlaceEvidence({...old,...decision,'核定方式':'历史迁移'},{allowHistoricalMigration:true}).ok,true);
  assert.equal(validatePlaceEvidence({...old,'核定结论':'地面到访'},{legacy:true}).ok,false);
});

test('候选晋级与正式地点共用核定合同',()=>{
  const candidate={'核定状态':'地面到访','证据':'原始照片与活动正文','关联正文':'旅行.md'};
  assert.equal(promotionDecision(candidate).ok,false);
  assert.equal(promotionDecision({...candidate,...decision}).ok,true);
  assert.equal(promotionDecision({...candidate,...decision,'证据引用':''}).ok,false);
});

test('城市和全球移动都要求发生依据与核定引用，内容判断不由关键词承担',()=>{
  const row={'核定结论':'合理重构','核定方式':'证据复核','证据引用':['正文:旅行.md','轨迹:2030-07-20'],'核定记录':'按活动先后确认需要移动，方式待核','发生依据':'同期城市活动及时间先后'};
  assert.equal(validateMovementEvidence(row).ok,true);
  assert.equal(validateMovementEvidence(row,{city:true}).ok,true);
  assert.equal(validateMovementEvidence({...row,'发生依据':''},{city:true}).ok,false);
  assert.equal(validateMovementEvidence({...row,'证据引用':[]}).ok,false);
  assert.equal(validateMovementEvidence({...row,'核定结论':'地面到访'}).ok,false);
});

test('所有移动源的unknown公里或时长不能混入计量，历史未分型档案保持可读',()=>{
  const review={'核定结论':'已发生','核定方式':'证据复核','证据引用':'正文:旅行.md','核定记录':'核实原记录发生事实','发生依据':'已核地面活动'};
  for(const amount of [{'里程公里':'20','里程类型':'unknown'},{'统计采用里程公里':'30','里程类型':'unknown'},
    {'交通时长分钟':'25','时长类型':'unknown'},{'飞行时长分钟':'35','时长类型':'unknown'},
    {'距离模型':'road','里程类型':'unknown'}]){
    for(const city of [false,true])assert.equal(validateMovementEvidence({...review,...amount,'计程纳入':'是'},{city}).ok,false);
    assert.equal(validateMovementEvidence({...review,...amount,'计程纳入':'否'}).ok,true);
  }
  assert.equal(validateMovementEvidence({'里程公里':'20','飞行时长分钟':'25'},{legacy:true}).ok,true);
  assert.equal(validateMovementEvidence({'里程公里':'20','里程类型':'unknown'},{legacy:true}).ok,false);
  assert.equal(validateMovementEvidence({...review,'统计采用里程公里':'','里程公里':'20','里程类型':'unknown','计程纳入':'是'}).ok,true);
});
