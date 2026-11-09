import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationReview} from '../scripts/migrate-evidence.mjs';
import {reconstructConnection} from '../scripts/reconstruct-connections.mjs';

const place={'地点编号':'EXAMPLE','到访状态':'已到访','核定依据':'示例来源核定','关联正文':'example.md'};
const connection={'交通编号':'EXAMPLE-LINK','坐标序列纬经':'[[0,0],[0,0.1]]','途经节点':'Local Point；Transfer Point',
  '开始日期':'2030-01-01','结束日期':'2030-01-01','记录类型':'接驳段'};

test('迁移回执使用调用者指定日期，且不覆盖已有核定记录',()=>{
  const migrated=migrationReview(place,'regionPlaces',place,'2032-04-05');
  assert.match(migrated['核定记录'],/^2032-04-05 证据合同迁移/);
  const revised=migrationReview({...place,'核定依据':'新的来源核定'},'regionPlaces',place,'2032-06-07');
  assert.match(revised['核定记录'],/^2032-06-07 按已核正文与原记录修正/);
  assert.equal(migrationReview(migrated,'regionPlaces',migrated,'2033-01-01'),migrated);
});

test('重建和身份复核使用同一可控回执日期，不冒充移动发生日',()=>{
  const options={before:{id:'A'},after:{id:'B'},recordedOn:'2032-04-05'};
  const rebuilt=reconstructConnection(connection,options);
  assert.match(rebuilt.row['核定记录'],/^2032-04-05 合理重建/);
  assert.match(rebuilt.row['核定记录'],/窗口：2030-01-01—2030-01-01/);
  const identity=reconstructConnection(connection,{...options,curation:{'EXAMPLE-LINK':{identity:true,basis:'同一节点不同来源名称'}}});
  assert.match(identity.row['核定记录'],/^2032-04-05 节点身份复核/);
});

test('未指定日期时采用运行日期，非法回执日期直接拒绝',()=>{
  const today=new Date().toISOString().slice(0,10);
  assert.ok(migrationReview(place,'regionPlaces',place)['核定记录'].startsWith(today));
  for(const recordedOn of ['2032-13-01','2031-02-29','not-a-date']){
    assert.throws(()=>migrationReview(place,'regionPlaces',place,recordedOn),/有效的 YYYY-MM-DD/);
    assert.throws(()=>reconstructConnection(connection,{recordedOn}),/有效的 YYYY-MM-DD/);
  }
});
