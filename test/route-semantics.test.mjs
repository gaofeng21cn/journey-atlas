import test from 'node:test';
import assert from 'node:assert/strict';
import {describeMovement,movementExtent,movementSummary,countPassportMovement,isRecordedMovement} from '../src/route-semantics.mjs';
import {durationSummary,travelTime} from '../src/transport-time.mjs';
import {createScopeEngine} from '../src/scope-model.mjs';

test('范围取行政归属，不以30公里或车辆类型猜同城；缺归属不假定境内',()=>{
  const same={mode:'市内交通',km:80,countries:['示例国'],cityKeys:['Metro Alpha','Metro Alpha']};
  assert.equal(describeMovement(same).mode,'地面交通');
  assert.equal(describeMovement(same).sourceMode,'市内交通');
  assert.equal(describeMovement(same).movementExtent,'市内');
  assert.equal(movementExtent({...same,km:2,cityKeys:['Metro Alpha','Metro Beta']}),'城际');
  assert.equal(movementExtent({...same,countries:['中国','中国香港']}),'跨境');
  assert.equal(movementExtent({...same,cityKeys:['Metro Alpha','']}),'范围未定');
  assert.equal(movementExtent({...same,countries:['中国','']}),'范围未定');
  assert.equal(movementExtent({...same,cityKeys:[],cities:['Metro Alpha','Metro Alpha']}),'市内');
  assert.equal(same.mode,'市内交通');
});

test('统一地面方式保留原时长模型，分类汇总不漏GPS移动',()=>{
  const routes=[{mode:'市内交通',km:20},{mode:'地面交通待定',km:100},{mode:'步行',km:4.5}];
  const normalized=routes.map(describeMovement);
  assert.equal(travelTime(normalized[0]).minutes,travelTime(routes[0]).minutes);
  assert.equal(travelTime(normalized[1]).minutes,travelTime(routes[1]).minutes);
  assert.equal(durationSummary(normalized).minutes,durationSummary(routes).minutes);
  assert.equal(durationSummary(normalized).modes.filter(m=>m.mode==='地面交通').length,1);
  assert.deepEqual(movementSummary(normalized).modes.find(m=>m.mode==='地面交通'),{mode:'地面交通',records:2,km:120});
});

test('国家及以上不计步行段数，省和城市保留，全部公里、时间和地图路线不减',()=>{
  const p={id:'P',name:'地点',country:'中国',unitId:'CN-44',cityId:'guangzhou',lat:23,lon:113,active:true};
  const routes=[{id:'WALK',mode:'步行',date:'2020-01-01',km:4.5,nodes:[p,p]},
    {id:'ROAD',mode:'公路',date:'2020-01-01',km:30,nodes:[p,p]}];
  const scopes=[{id:'world',level:'world',countries:['中国'],units:[]},
    {id:'asia',level:'macro',parent:'world',countries:['中国'],units:[]},
    {id:'china',level:'country',parent:'asia',countries:['中国'],units:[]},
    {id:'unit:CN-44',level:'unit',parent:'china',unitId:'CN-44',countries:['中国'],units:[]},
    {id:'city:guangzhou',level:'city',parent:'unit:CN-44',cityId:'guangzhou',countries:['中国'],units:[]}];
  const engine=createScopeEngine({meta:{totalKm:34.5},places:[p],routes,scopes});
  for(const s of scopes){const view=engine.query(s.id);
    assert.equal(view.stats.routes,['world','macro','country'].includes(s.level)?1:2);
    assert.equal(view.stats.allMoves,2);assert.equal(view.stats.walkingMoves,1);
    assert.equal(view.stats.km,34.5);assert.equal(view.stats.travelMinutes,120);assert.equal(view.routes.length,2);
  }
  assert.equal(countPassportMovement(routes[0],{level:'city',movementCountLevel:'country'}),false);
});

test('同次档案接入边引用定位计量归属，模型数值保留而段数与距离不重复',()=>{
  const actual={id:'GPS',mode:'地面交通',countries:['示例城邦'],km:12.34,travelMinutes:42.5};
  const access={...actual,id:'ACCESS',countDistance:false,countDuration:false,metricOwnerIds:['GPS']};
  const structural={...actual,id:'LINK',structuralLink:true},candidate={...actual,id:'CANDIDATE',candidate:true};
  const summary=movementSummary([actual,access,structural,candidate]);
  assert.equal(isRecordedMovement(access),false);assert.equal(summary.allMoves,1);assert.equal(summary.displayMoves,1);
  assert.equal(summary.modes[0].km,12.34);assert.equal(durationSummary([actual,access,structural,candidate]).minutes,42.5);
  assert.equal(access.km,12.34);
});
