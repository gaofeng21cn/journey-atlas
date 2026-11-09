import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayIdentity} from '../src/city-gateways.mjs';

const scope={id:'city:sample',cityId:'sample',name:'示例城市',bounds:[10.8,20.8,11.2,21.2]};

test('同一外部城市的周边与正式名称合并为稳定页边身份',()=>{
  const a=gatewayIdentity({name:'邻近甲城周边',country:'中国',lat:20.8,lon:10.8},{scope});
  const b=gatewayIdentity({name:'邻近甲城市',country:'中国',lat:20.7,lon:10.7},{scope});
  assert.equal(a.key,b.key);
  assert.equal(a.name,'邻近甲城');
});

test('城市投影窗口外的本地定位统一为本地周边',()=>{
  const result=gatewayIdentity({name:'中国·位置记录',country:'中国',cityId:'sample',lat:22.2,lon:11.2},{scope});
  assert.equal(result.key,'local|city:sample');
  assert.equal(result.name,'示例城市周边');
});

test('没有城市名的远端定位显示为外部城市待识别',()=>{
  const result=gatewayIdentity({name:'·位置记录',country:'中国',lat:5,lon:5},{scope});
  assert.equal(result.key,'other|中国');
  assert.equal(result.name,'外部城市待识别');
  assert.equal(result.kind,'unknown');
  assert.match(result.description,/只有定位坐标/);
});

test('机场节点优先采用服务城市并保留稳定身份',()=>{
  const result=gatewayIdentity({name:'示例机场',serviceName:'枢纽甲城',country:'中国',lat:30,lon:30},{scope,catalog:[{name:'枢纽甲城',canonical:'枢纽甲城',country:'中国',lat:30.1,lon:30.1}]});
  assert.equal(result.name,'枢纽甲城');
  assert.equal(result.kind,'city');
  assert.equal(result.source,'service-city');
});

test('无名端点优先使用维护的城市目录',()=>{
  const result=gatewayIdentity({name:'中国·位置记录',country:'中国',lat:30.01,lon:30.01},{scope,catalog:[{name:'目录甲城',canonical:'目录甲城',country:'中国',lat:30.012,lon:30.01}]});
  assert.equal(result.name,'目录甲城');
  assert.equal(result.source,'catalog');
});

test('无名机场或GPS端点使用公共甲城目录归一，不显示待识别标签',()=>{
  const result=gatewayIdentity({name:'·位置记录',country:'中国',lat:21.4,lon:11.4},{scope,catalog:[{name:'公共甲城',canonical:'公共甲城',country:'中国',lat:21.45,lon:11.45,source:'public-city'}]});
  assert.equal(result.name,'公共甲城');
  assert.equal(result.kind,'nearby');
  assert.equal(result.source,'public-city');
  assert.ok(result.distanceKm<20);
});

test('显式甲城名优先于附近公共甲城，避免反向地理目录过度解读',()=>{
  const result=gatewayIdentity({name:'显式甲城',country:'中国',lat:31,lon:31},{scope,catalog:[
    {name:'显式甲城',canonical:'显式甲城',country:'中国',lat:31,lon:31,source:'catalog'},
    {name:'邻近公共甲城',canonical:'邻近公共甲城',country:'中国',lat:31.05,lon:31.05,source:'public-city'},
  ]});
  assert.equal(result.name,'显式甲城');
  assert.equal(result.source,'catalog');
});
