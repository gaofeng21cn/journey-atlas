import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvidenceDelta} from '../scripts/update-atlas.mjs';
import {displayCityDetails} from '../scripts/site-data.mjs';
import {readFile} from 'node:fs/promises';
import {validatePlaceEvidence,validateMovementEvidence} from '../scripts/evidence-contract.mjs';
import {readGround} from '../scripts/atlas-data.mjs';
import {readRegionPlaces} from '../scripts/region-data.mjs';

const review={'核定结论':'合理重构','核定方式':'证据复核','证据引用':'正文:旅行.md','核定记录':'2026-10-11 复核该次进入与离开的移动'};
const movement=()=>({'移动编号':'M1','城市编号':'sample','行程编号':'trip','日期':'2020-01-01','段序':'1','出发地点编号':'A','到达地点编号':'B','交通方式':'公路','里程公里':'10','交通时长分钟':'20','发生依据':'活动先后支持该次公路移动','关联正文':'旅行.md',...review});

test('公共虚构更新示例通过严格证据与计量合同，不携带个人核定',async()=>{
  const example=JSON.parse(await readFile(new URL('../examples/atlas-update.json',import.meta.url),'utf8'));
  for(const p of example.places){const result=validatePlaceEvidence(p);assert.equal(result.ok,true,result.errors.join('；'));}
  for(const r of example.ground){const result=validateMovementEvidence(r);assert.equal(result.ok,true,result.errors.join('；'));}
  const catalog=JSON.parse(await readFile(new URL('../data/region-catalog.json',import.meta.url),'utf8'));
  const places=readRegionPlaces(example.places,catalog,{legacy:false}),index=new Map(places.map(p=>[p.id,p]));
  const [ground]=readGround(example.ground,index,{legacy:false,allowLegacyRefs:false});
  assert.equal(ground.distanceType,'model');assert.equal(ground.durationType,'reference');assert.equal(ground.geometryType,'display');
  assert.ok(ground.km>0);assert.deepEqual(ground.nodeIds,['EXAMPLE-A','EXAMPLE-B','EXAMPLE-A']);
});

test('城市事实新增和修改不能沿用历史迁移核定',()=>{
  const old={...movement(),'核定方式':'历史迁移'};
  assert.throws(()=>validateEvidenceDelta([],[old],'cityMoves',{migration:true}),/历史迁移/);
  assert.throws(()=>validateEvidenceDelta([old],[{...old,'里程公里':'11'}],'cityMoves',{migration:true}),/历史迁移/);
  assert.throws(()=>validateEvidenceDelta([movement()],[{...movement(),'里程公里':'11'}],'cityMoves'),/事实修订/);
  assert.throws(()=>validateEvidenceDelta([movement()],[{...movement(),'里程公里':'11','证据引用':'轨迹:新定位窗口'}],'cityMoves'),/事实修订/);
  assert.doesNotThrow(()=>validateEvidenceDelta([movement()],[{...movement(),'里程公里':'11','核定记录':'2026-10-11 根据有日期的GPS窗口重新复核数值'}],'cityMoves'));
});

test('计程重新启用不能借纯Schema迁移升级事实，撤回粗估算保留明确审查记录',()=>{
  const excluded={...movement(),'计程纳入':'否','核定方式':'历史迁移'};
  assert.throws(()=>validateEvidenceDelta([excluded],[{...excluded,'计程纳入':'是','核定记录':'只补字段'}],'cityMoves',{migration:true}),/历史迁移/);
  const old=movement(),coarse={...old,'记录类型':'区域接续','计程纳入':'否','里程公里':'','交通时长分钟':'','里程类型':'unknown','时长类型':'unknown','线形类型':'unknown','核定记录':'2026-10-11 结构审查撤回代表点估算；保留必要接续，未重新核看活动原件'};
  assert.doesNotThrow(()=>validateEvidenceDelta([old],[coarse],'cityMoves',{migration:true}));
  assert.throws(()=>validateEvidenceDelta([old],[{...coarse,'核定方式':'历史迁移'}],'cityMoves',{migration:true}),/历史迁移/);
});

test('纯字段迁移可透明保留历史结论，不能把待核晋级混入迁移',()=>{
  const old=movement(),after={...old,'核定方式':'历史迁移','核定记录':'保留既有结论，未重新核看原件','里程类型':'model','时长类型':'model','线形类型':'display'};
  assert.doesNotThrow(()=>validateEvidenceDelta([old],[after],'cityMoves',{migration:true}));
  const place={'地点编号':'P','到访状态':'待核','核定依据':'定位候选','关联正文':'旅行.md'};
  assert.throws(()=>validateEvidenceDelta([place],[{...place,'到访状态':'已到访','核定结论':'地面到访','核定方式':'历史迁移','证据引用':'uuid:photo','核定记录':'直接晋级'}],'cityPlaces',{migration:true}),/历史迁移/);
});

test('城市GPS实测校准必须重新核定，不能只改类型标签',()=>{
  const old=movement(),observed={...old,'里程公里':'8.24','交通时长分钟':'17.5','里程类型':'observed','时长类型':'observed','线形类型':'observed','GPS轨迹编号':'T1','GPS开始时间':'100','GPS结束时间':'1150','核定结论':'已发生'};
  assert.throws(()=>validateEvidenceDelta([old],[observed],'cityMoves'),/事实修订/);
  assert.doesNotThrow(()=>validateEvidenceDelta([old],[{...observed,'核定记录':'2026-10-11 对齐已核活动地点及GPS窗口，校准移动数值'}],'cityMoves'));
});

test('城市浏览器投影保留地图与筛选字段，剥离嵌套私人证据和原始时刻',()=>{
  const privateNode={id:'A',name:'甲地',lat:1,lon:2,cityId:'sample',districtId:'W',active:true,source:'私人正文.md',evidence:{references:['uuid:private-photo']}};
  const cities={sample:{places:[privateNode],routes:[{id:'M1',nodes:[privateNode,{...privateNode,id:'B'}],path:[[2,1],[3,2]],km:1,travelMinutes:5,geometryType:'observed',durationType:'observed',source:'私人正文.md',occurrenceBasis:'本人陈述',evidence:{references:['uuid:private-photo']},trackId:'PRIVATE-TRACK',observedStart:1234567890,observedEnd:1234567990,date:'2020-01-01'}],
    trips:[{id:'J',name:'游览',first:'2020-01-01',last:'2020-01-01',source:'私人正文.md',boundaryBasis:'私人入住信息'}],visits:[{source:'私人正文.md'}],tracks:[{id:'PRIVATE-TRACK',date:'2020-01-01',points:[[2,1],[3,2]],start:1234567890,end:1234567990,sampleTimes:[1234567890,1234567990],sampleAccuracies:[4,4]}],evidence:{source:'PRIVATE-BACKUP'},parentPlaceIds:['GLOBAL-A']}};
  cities.sample.photoPoints=[{date:'2020-01-01',lat:1,lon:2,uuid:'private-photo',time:1234567890}];cities.sample.evidence.usableGps=300000;
  cities.sample.inferredRoutes=[{...cities.sample.routes[0],id:'recon:M1',reconstructed:true,start:1234567890,end:1234567990,evidenceReferences:['uuid:private-photo'],distanceRange:[.8,1.2],durationRange:[3,8]}];
  cities.sample.reconstruction={version:1,summary:{moves:1},visits:[{references:['uuid:private-photo']}],conflicts:[{time:1234567890}]};
  const projected=displayCityDetails(cities).sample,serialized=JSON.stringify(projected);
  for(const secret of ['私人正文','本人陈述','private-photo','PRIVATE-TRACK','1234567890','sampleTimes','sampleAccuracies','occurrenceBasis','observedStart'])assert.equal(serialized.includes(secret),false,secret);
  assert.deepEqual(projected.routes[0].path,[[2,1],[3,2]]);
  assert.equal(projected.routes[0].geometryType,'observed');
  assert.equal(projected.routes[0].travelMinutes,5);
  assert.equal(projected.inferredRoutes[0].reconstructed,true);assert.deepEqual(projected.inferredRoutes[0].distanceRange,[.8,1.2]);
  assert.equal(projected.trips[0].name,'游览');
  assert.equal(projected.tracks[0].date,'2020-01-01');
  assert.deepEqual(projected.photoPoints,[{date:'2020-01-01',lat:1,lon:2}]);assert.equal(projected.evidence.usableGps,300000);
  assert.deepEqual(projected.parentPlaceIds,['GLOBAL-A']);
});
