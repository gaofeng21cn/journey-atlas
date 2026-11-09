import test from 'node:test';
import assert from 'node:assert/strict';
import {travelTime,durationSummary} from '../src/transport-time.mjs';

test('保存的模型时长仍然是估算，凭据与实测来源才成为记录时长',()=>{
  const base={mode:'市内交通',km:4,travelMinutes:17,travelDurationBasis:'方式模型'};
  assert.equal(travelTime({...base,durationType:'model'}).estimated,true);
  assert.equal(travelTime({...base,durationType:'reference'}).estimated,true);
  assert.equal(travelTime({...base,durationType:'observed'}).estimated,false);
  assert.equal(travelTime({...base,durationType:'archived'}).estimated,false);
  assert.equal(travelTime(base).estimated,true);
  assert.equal(travelTime(base).type,'unknown');
});

test('不计程区域接续不能用代表点距离偷偷生成时长',()=>{
  const coarse={mode:'公路',recordType:'区域接续',km:200,travelMinutes:180};
  assert.equal(travelTime(coarse).minutes,null);
  const summary=durationSummary([coarse,{mode:'公路',countDuration:false,km:100},{mode:'步行',km:1,durationType:'model',travelMinutes:13}]);
  assert.equal(summary.minutes,13);assert.equal(summary.estimated,1);assert.equal(summary.excluded,2);assert.equal(summary.missing,0);
});

test('缺失时长模型与未知方式保持可区分的来源',()=>{
  assert.equal(travelTime({mode:'步行',km:4.5}).minutes,60);
  assert.equal(travelTime({mode:'市内交通',km:20}).type,'model');
  assert.equal(travelTime({mode:'接续方式待核',km:5}).minutes,null);
});

test('飞行时长只来自维护航段，未填分钟不在动态页面独立估算',()=>{
  const missing={mode:'飞机',km:675,minutes:null,durationType:'unknown'};
  assert.equal(travelTime(missing).minutes,null);assert.equal(travelTime(missing).type,'unknown');
  const supplied=[
    {mode:'飞机',km:1000,minutes:120,durationType:'archived'},
    {mode:'飞机',km:675,minutes:90,durationType:'model'},
    {mode:'飞机',km:800,minutes:100,durationType:'reference'},
  ];
  const summary=durationSummary([...supplied,missing]);
  assert.equal(summary.minutes,310);assert.equal(summary.modes[0].minutes,310);
  assert.equal(summary.estimated,2);assert.equal(summary.missing,1);
  assert.equal(durationSummary([...supplied,{...missing,minutes:90,durationType:'model'}]).minutes,400);
});

test('未知结构连接与候选即使带遗留数值也不计时间',()=>{
  const base={mode:'飞机',km:675,minutes:90,durationType:'model'};
  const summary=durationSummary([
    {...base,structuralLink:true},{...base,candidate:true},{...base,recordType:'资料间隔'},
    {...base,include:false},base,
  ]);
  assert.equal(summary.minutes,90);assert.equal(summary.estimated,1);assert.equal(summary.excluded,4);assert.equal(summary.missing,0);
});
