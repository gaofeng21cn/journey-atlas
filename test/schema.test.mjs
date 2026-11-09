import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION, TABLES, GROUND_HEADERS, JAPAN_PLACE_HEADERS,
  REGION_PLACE_HEADERS, JOURNEY_HEADERS, CITY_PLACE_HEADERS, CITY_MOVE_HEADERS, UPDATE_DEFINITIONS, sourceHeaders,
} from '../scripts/schema.mjs';

test('维护表 schema 是唯一且无重复字段', () => {
  assert.equal(SCHEMA_VERSION, 8);
  assert.ok(GROUND_HEADERS.includes('交通时长分钟'));
  assert.ok(GROUND_HEADERS.includes('交通时长依据'));
  for (const headers of [GROUND_HEADERS, JAPAN_PLACE_HEADERS, REGION_PLACE_HEADERS, JOURNEY_HEADERS,CITY_PLACE_HEADERS,CITY_MOVE_HEADERS]) {
    assert.equal(new Set(headers).size, headers.length);
  }
  assert.equal(UPDATE_DEFINITIONS.ground.file, TABLES.ground);
  assert.equal(sourceHeaders('journeys'), JOURNEY_HEADERS);
});

test('更新定义覆盖基础表、到访核定表和可选城市细节表', () => {
  assert.deepEqual(Object.keys(UPDATE_DEFINITIONS).sort(), ['cityMoves','cityPlaces','flightArchive','ground', 'japanPlaces', 'journeys', 'regionPlaces','visitCandidates','visits']);
  assert.equal(UPDATE_DEFINITIONS.ground.id, '交通编号');
  assert.equal(UPDATE_DEFINITIONS.japanPlaces.id, '地点编号');
  assert.equal(UPDATE_DEFINITIONS.regionPlaces.id, '地点编号');
  assert.equal(UPDATE_DEFINITIONS.journeys.id, '行程编号');
  assert.equal(UPDATE_DEFINITIONS.cityPlaces.optional,true);
  assert.equal(UPDATE_DEFINITIONS.cityMoves.id,'移动编号');
});
