import test from 'node:test';
import assert from 'node:assert/strict';
import { toTopology } from '../scripts/prepare-open-geography.mjs';
import { japanMap } from '../scripts/japan-map.mjs';

const square=(lon,lat,id)=>({type:'Feature',id,properties:{id},geometry:{type:'Polygon',coordinates:[[[lon,lat],[lon+.1,lat],[lon+.1,lat+.1],[lon,lat+.1],[lon,lat]]]}});
const atlasFor=(names,routes=[])=>({
  prefectures:Array.from({length:47},(_,i)=>({id:String(i+1).padStart(2,'0'),visited:false,name:`县${i+1}`})),
  routes,places:names.map((name,i)=>({id:`P-${i}`,name,lat:35.6+i*.05,lon:139.6+i*.05,status:'已到访',include:true,prefectureId:'13'})),
  japan:{visited:0,cities:names.length},
});

test('日本地图城市标签来自到访地点和路线频率，不依赖固定个人城市名单',()=>{
  const topology=toTopology(Array.from({length:47},(_,i)=>square(129+i*.2,31+i*.1,i+1)),'japan',{propertyId:'id'});
  const places=atlasFor(['未在固定清单中的城市']);
  const svg=japanMap(topology,places);
  assert.match(svg,/未在固定清单中的城市/);
  assert.match(svg,/data-place-label="P-0"/);
  assert.doesNotMatch(svg,/Default City A|Default City B|Default City C|Default City D/);
});

test('日本地图密集地点优先标注高频路线端点，排除路线不影响排序',()=>{
  const topology=toTopology(Array.from({length:47},(_,i)=>square(129+i*.2,31+i*.1,i+1)),'japan',{propertyId:'id'});
  const names=Array.from({length:9},(_,i)=>'城市'+String.fromCharCode(65+i));
  const atlas=atlasFor(names,[
    {id:'R',mode:'铁路',names:[names[8],'外部地点'],points:[[36,140],[35.5,139.5]]},
    {id:'X',mode:'铁路',names:[names[0],'外部地点'],points:[[35.6,139.6],[35.5,139.5]],include:false},
  ]);
  const svg=japanMap(topology,atlas);
  const ids=[...svg.matchAll(/data-place-label="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids[0],'P-8');
});
