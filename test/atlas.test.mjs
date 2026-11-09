import test from 'node:test';
import assert from 'node:assert/strict';
import { readGround, readPlaces, aggregatePrefectures, buildAtlas, distanceKm } from '../scripts/atlas-data.mjs';
import { projector } from '../scripts/japan-map.mjs';
import {flightView} from '../scripts/flight-view.mjs';
import {durationSummary} from '../src/transport-time.mjs';

const row = {
  '交通编号':'GT-1','日期或区间':'2026-10-01','交通方式':'铁路','途经节点':'甲；乙',
  '坐标序列纬经':'[[35,135],[36,136]]','里程公里':'172','里程依据':'线路参考',
  '国家地区':'日本','分享纳入':'纳入','关联正文':'路线.md','发生依据':'列车画面','发生状态':'画面支持'
};

test('没有定位层时，维护的地面交通和步行仍计入地面总里程',()=>{
  const ground=readGround([{...row,'交通方式':'地面交通','交通工具':'大巴'},
    {...row,'交通编号':'WALK','交通方式':'步行','里程公里':'2'}]);
  const a=buildAtlas({flights:[],ground,places:[],prefectures:[],countryFlags:[]});
  assert.equal(a.meta.totalKm,174);assert.equal(a.meta.groundKm,174);assert.equal(ground[0].vehicle,'大巴');
});
test('已知距离、未知距离与排除记录分别聚合，不把空值当0或加入排除行',()=>{
  const ground=readGround([row,{...row,'交通编号':'GT-2','日期或区间':'2026-10-02','里程公里':''},
    {...row,'交通编号':'GT-3','日期或区间':'2026-10-03','分享纳入':'排除'}]);
  const a=buildAtlas({flights:[],ground,places:[],prefectures:[['01','北海道','北海道','北海道']],countryFlags:[]});
  assert.equal(a.meta.totalKm,172);assert.equal(a.meta.routes,2);assert.equal(a.meta.missingKm,1);
  assert.throws(()=>readGround([row,{...row,'交通编号':'GT-4'}]),/重复/);
  assert.throws(()=>readGround([{...row,'交通方式':'地面交通待定'}]),/合理占位估算/);
  assert.equal(readGround([{...row,'交通方式':'地面交通待定','里程依据':'合理占位估算：代表节点站位'}])[0].km,172);
  assert.throws(()=>readGround([{...row,'里程公里':'0'}]),/正数/);
});
test('日本机场、途经与待核地点不点亮县、不增加已到访城市；同县多城市只计一县',()=>{
  const prefs=[['07','福岛县','福島県','东北'],['13','东京都','東京都','关东']];
  const p=(id,code,status)=>({'地点编号':id,'都道府县代码':code,'城市/城镇':id,'到访状态':status,'核定依据':'地面活动','关联正文':'旅行.md'});
  const places=readPlaces([p('郡山','07','待核'),p('机场','07','途经/机场'),p('东京','13','已到访'),p('町田','13','已到访')],prefs);
  const sums=aggregatePrefectures(prefs,places);
  assert.equal(sums[0].visited,false);assert.equal(sums[1].visited,true);assert.equal(sums[1].cities.length,2);
  assert.throws(()=>readPlaces([{...p('新点','13','已到访'),'核定依据':''}],prefs),/缺少依据/);
});
test('路线距离保留经由点和往返；日本投影纬度越北越高、经度越东越右',()=>{
  const a=[35,135],b=[36,136];
  assert.equal(distanceKm([a,b,a],'rail'),2*distanceKm([a,b],'rail'));
  assert.equal(distanceKm([a,b],''),null);
  const p=projector([128,30,146,46],[0,0,1000,700]);
  assert.ok(p([43,141])[1]<p([35,139])[1]);assert.ok(p([35,141])[0]>p([35,139])[0]);
});

test('补充飞机任一时长字段归一为一个值和依据，三种统计不再分叉',()=>{
  for(const field of ['飞行','交通']){
    const source={...row,'交通方式':'飞机',[field+'时长分钟']:'90',[field+'时长依据']:'本行公开时刻参考',
      '时长类型':'reference','里程类型':'reference','线形类型':'display','计程纳入':'是'};
    const route=readGround([source])[0];
    assert.equal(route.minutes,90);assert.equal(route.travelMinutes,90);
    assert.equal(route.durationBasis,'本行公开时刻参考');assert.equal(route.travelDurationBasis,'本行公开时刻参考');
    assert.equal(route.durationType,'reference');assert.equal(source[field==='飞行'?'交通时长分钟':'飞行时长分钟'],undefined);
    const atlas=buildAtlas({flights:[],ground:[route],places:[],prefectures:[],countryFlags:[]});
    atlas.locationLayer={places:[]};
    assert.equal(atlas.meta.flightMinutes,90);assert.equal(flightView(atlas).meta.totalMinutes,90);
    assert.equal(durationSummary(atlas.routes).modes.find(m=>m.mode==='飞机').minutes,90);
  }
  assert.throws(()=>readGround([{...row,'交通方式':'飞机','飞行时长分钟':'90','飞行时长依据':'凭证A',
    '交通时长分钟':'95','交通时长依据':'凭证B'}]),/两套飞行时长冲突/);
});
