import test from 'node:test';
import assert from 'node:assert/strict';
import {countryIntensity} from '../scripts/atlas-data.mjs';

test('国家强度采用境内移动、区分香港与内地，跨境与纯转机不增加覆盖或排序里程',()=>{
  const countries=[{name:'中国香港'},{name:'日本'},{name:'中国'}];
  const r=(id,countries,km,mode='公路',extra={})=>({id,countries,km,mode,...extra});
  const routes=[r('JP',['日本'],100),r('CN',['中国'],200,'飞机'),r('HK',['中国香港'],30),
    r('INT',['中国','日本'],4000,'飞机'),r('HUB',['转机国'],20),r('EX',['日本'],800,'公路',{include:false}),
    r('LINK',['日本'],500,'公路',{structuralLink:true}),r('NO',['日本'],500,'公路',{countDistance:false}),
    r('UNKNOWN',['中国',''],9000)];
  const result=countryIntensity(countries,routes);
  assert.deepEqual(result.map(c=>c.name),['中国','日本','中国香港']);
  assert.deepEqual(result.map(c=>c.km),[200,100,30]);assert.equal(result[0].flightKm,200);assert.equal(result[0].groundKm,0);
  assert.equal(result.length,3);assert.deepEqual(countries.map(c=>c.name),['中国香港','日本','中国']);
});
