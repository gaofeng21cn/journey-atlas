import test from 'node:test';
import assert from 'node:assert/strict';
import {passportSummary,traceAtlasRecord} from '../scripts/passport.mjs';

function fixture(){
  const place={id:'P',name:'东京',country:'日本',include:true,status:'已到访'};
  const entering={id:'IN',nodePlaceIds:['','P']},leaving={id:'OUT',nodePlaceIds:['P','']};
  const interval={id:'GAP',recordType:'资料间隔',status:'待还原',structuralLink:true,previousTransport:'IN',nextTransport:'OUT',nodePlaceIds:['P','P']};
  const visit={id:'V',placeId:'P',journeyId:'J',incoming:['IN'],outgoing:['GAP'],continuity:'待还原',include:true,access:{complete:true,pending:false,state:'待还原'}};
  return {locationLayer:{places:[place],summary:{}},journeyLayer:{journeys:[{id:'J',transport:[entering,leaving],transportIds:['IN','OUT']}],summary:{}},
    journeySummaries:[{'行程编号':'J'}],routes:[entering,leaving],managedConnections:[interval],connectionIntervals:[interval],
    visitInstances:[visit],visitInstanceSummary:{records:1,shared:1,complete:1,pending:0,awaitingReview:1},
    hubLinks:[],journeyContinuity:[{'闭环状态':'待接续'}],nodeReferences:[],meta:{flightMinutes:0},japan:{},regions:{},improvements:[],trajectorySummary:{},nodeReferenceSummary:{}};
}

test('状态同时报告实例结构与未还原关系，不把待还原组报成闭环',()=>{
  const report=passportSummary(fixture());
  assert.equal(report.visits.complete,1);assert.equal(report.visits.awaitingReview,1);
  assert.equal(report.connections.maintained,1);assert.equal(report.connections.observationIntervals,1);
  assert.equal(report.connections.awaitingRestoration,0);
  assert.equal(report.reconstruction.visits.missingMovement,0);
  assert.equal(report.reconstruction.visits.observationCoverageOnly,1);
  assert.equal(report.closure.pending,1);assert.equal(report.closure.balanced,0);
});

test('状态摘要复用重建进度，缺少计量的真实接驳仍列为移动待恢复',()=>{
  const atlas=fixture();
  const move={id:'LINK',recordType:'接驳段',status:'合理重构',previousTransport:'IN',nextTransport:'OUT',km:null,travelMinutes:null};
  atlas.managedConnections.push(move);atlas.visitInstances[0].outgoing=['LINK'];
  const report=passportSummary(atlas);
  assert.equal(report.connections.awaitingRestoration,1);
  assert.equal(report.connections.awaitingRestoration,report.reconstruction.connections.pending);
  assert.equal(report.reconstruction.visits.missingMovement,1);
  assert.equal(report.reconstruction.visits.observationCoverageOnly,0);
});

test('trace支持独立到访实例及资料间隔，并回读前后实际交通',()=>{
  const atlas=fixture(),v=traceAtlasRecord(atlas,'V');
  assert.equal(v.layer,'到访实例');assert.equal(v.place.id,'P');
  assert.equal(v.entering[0].id,'IN');assert.equal(v.leaving[0].id,'GAP');
  const gap=traceAtlasRecord(atlas,'GAP');assert.equal(gap.layer,'资料间隔');assert.equal(gap.visits[0].id,'V');
  assert.equal(traceAtlasRecord(atlas,'P').visits.length,1);
  assert.equal(traceAtlasRecord(atlas,'J').connections.length,1);
  assert.throws(()=>traceAtlasRecord(atlas,'MISSING'),/未找到编号/);
});
