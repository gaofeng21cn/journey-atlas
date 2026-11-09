import test from 'node:test';
import assert from 'node:assert/strict';
import {readRegionPlaces,WORLD_COUNTRIES} from '../scripts/region-data.mjs';

test('国家校验支持完整ISO目录，不受原有旅行地区限制',()=>{
  const catalog={europe:{english:'EUROPE',units:[],countries:[]}};
  const rows=['BR','NZ','MX'].map(code=>({'地点编号':code,'城市/地点':'示例地点'+code,'国家地区':WORLD_COUNTRIES[code],'国家代码':code,'到访状态':'待核','分享纳入':'排除'}));
  assert.equal(readRegionPlaces(rows,catalog).length,3);
  assert.throws(()=>readRegionPlaces([{...rows[0],'国家地区':'美国'}],catalog),/不匹配/);
  assert.equal(WORLD_COUNTRIES.HK,'中国香港');
});
