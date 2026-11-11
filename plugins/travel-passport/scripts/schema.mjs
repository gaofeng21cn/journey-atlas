// The source-table contract lives here so readers, patch updates and migration
// helpers cannot silently drift apart when a column is added.
export const SCHEMA_VERSION = 8;

export const EVIDENCE_HEADERS = Object.freeze(['核定结论','核定方式','证据引用','核定记录']);
export const MEASUREMENT_HEADERS = Object.freeze(['里程类型','时长类型','线形类型','计程纳入']);

export const TABLES = Object.freeze({
  ground: '全旅程数据点-非飞行及补充交通.csv',
  places: '日本旅行数据点-地点.csv',
  prefectures: '日本旅行数据点-都道府县.csv',
  journeys: '全旅程数据点-行程.csv',
  regionPlaces: '地区旅行数据点-地点.csv',
  flightArchive: '飞行数据点-航段明细-20261009.csv',
  visitCandidates: '飞行数据点-到访城市-20261009.csv',
  cityPlaces: '城市旅行数据点-地点.csv',
  cityMoves: '城市旅行数据点-移动.csv',
  cityJourneys: '城市旅行数据点-行程.json',
  cityEvidence: '城市旅行数据点-定位证据.json',
  visits: '全旅程数据点-到访实例.csv',
});

export const OPTIONAL_SOURCE_FILES=Object.freeze([TABLES.cityPlaces,TABLES.cityMoves,TABLES.cityJourneys,TABLES.cityEvidence]);
export const CITY_PLACE_HEADERS=Object.freeze(['地点编号','城市编号','上级地点编号','地点名称','行政区代码','代表纬度','代表经度','到访状态','节点级别','最早线索日','最晚线索日','分享纳入','核定依据','照片来源关联编号','关联正文','备注',...EVIDENCE_HEADERS]);
export const CITY_MOVE_HEADERS=Object.freeze(['移动编号','城市编号','行程编号','日期','段序','出发地点编号','到达地点编号','交通方式','里程公里','交通时长分钟','里程依据','时长依据','发生依据','关联正文','路线几何经纬','路线几何依据','记录类型',...MEASUREMENT_HEADERS,...EVIDENCE_HEADERS,'GPS轨迹编号','GPS开始时间','GPS结束时间']);

export const VISIT_INSTANCE_HEADERS=Object.freeze(['到访编号','地点编号','行程编号','开始日期','结束日期','时间精度','活动性质','进入交通编号','离开交通编号','前序到访编号','后序到访编号','接续核定','核定方式','证据引用','核定记录','关联正文','分享纳入','开放边界','边界依据']);

// Derived layer filenames are shared by the loader and the export writers.
// Keep them in the schema contract so the two paths cannot drift apart.
export const JOURNEYS = TABLES.journeys;
export const TRAJECTORY = '全旅程数据点-城市轨迹.csv';

export const GROUND_HEADERS = Object.freeze([
  '交通编号','日期或区间','日期精度','交通方式','交通工具','途经节点','坐标序列纬经',
  '国家地区','里程公里','里程依据','发生状态','发生依据','关联正文',
  '分享纳入','备注','飞行时长分钟','飞行时长依据','地点编号序列','节点编号序列',
  '距离模型','开始日期','结束日期','时间精度','段序','记录类型','前序交通编号','后序交通编号','交通时长分钟','交通时长依据',
  ...EVIDENCE_HEADERS,...MEASUREMENT_HEADERS,'前序路线段','后序路线段','被覆盖交通段',
]);

// Keep the audited ticket/archive columns intact. Current flight updates merge
// by evidence identity, independently of the retired sharing snapshot importer.
export const FLIGHT_ARCHIVE_HEADERS = Object.freeze([
  '序号','记录类型','日期','年份','航空公司','航班号','出发城市','到达城市','里程公里',
  '出发国家地区','到达国家地区','纬度_出发','经度_出发','纬度_到达','经度_到达','备注',
  '出发服务城市','到达服务城市','出发机场归并名','到达机场归并名','证据编号','原始客票状态',
  '关联候选','日期依据','出发时间','到达时间','出发时区','到达时区','里程口径','到达日期推算',
  '推算飞行小时','审核提示','统计采用里程公里','统计里程依据','公开参考公里','公开参考英里',
  '公开参考来源','公开参考URL','公开参考口径','里程核对日期','里程差异结论','日期标准','日期状态',
  '航段发生依据','原始来源文件','原始来源工作表','原始来源行','本人确认日期','关联正文',
  '关联正文依据','飞行时长分钟','飞行时长依据','时刻使用策略',...EVIDENCE_HEADERS,...MEASUREMENT_HEADERS,
]);

export const JAPAN_PLACE_HEADERS = Object.freeze([
  '地点编号','城市/城镇','都道府县代码','都道府县','到访状态','核定依据',
  '最早线索日','最晚线索日','代表纬度','代表经度','原地名','关联正文',
  '照片来源关联编号','备注','分享纳入','节点级别','上级节点编号',
  '交通接入确认','交通接入起始日期','交通接入结束日期',
  '地面节点关联',
  ...EVIDENCE_HEADERS,
]);

export const REGION_PLACE_HEADERS = Object.freeze([
  '地点编号','国家地区','国家代码','一级区域代码','城市/地点','到访状态',
  '核定依据','最早线索日','最晚线索日','代表纬度','代表经度','原地名',
  '关联正文','照片来源关联编号','分享纳入','备注','节点级别','上级节点编号',
  '交通接入确认','交通接入起始日期','交通接入结束日期',
  '地面节点关联',
  ...EVIDENCE_HEADERS,
]);

export const JOURNEY_HEADERS = Object.freeze([
  '行程编号','行程名称','出发基地地点编号','出发基地','日期或区间','日期精度',
  '重构状态','行程依据','关联交通编号','关联正文','分享纳入','备注',
  '闭环组编号','行程形态','闭环依据',
]);

export const TRAJECTORY_HEADERS = Object.freeze([
  '轨迹序号','日期','出发地','到达地','出发节点编号','到达节点编号',
  '出发地点编号','到达地点编号','开始日期','结束日期','时间精度',
  '出发纬度','出发经度','到达纬度','到达经度','交通方式','里程米',
  '里程公里','里程依据','计程纳入','发生状态','接续状态','接续类型','接续说明',
  '所属行程编号','所属行程名称','交通编号','路线段','关联正文',
  '排序依据','排序问题',
]);

// Fields that are allowed in a partial update. Keeping these beside the source
// headers makes the update API additive: a new source column is opt-in here,
// rather than accidentally accepted by one path and rejected by another.
export const UPDATE_DEFINITIONS = Object.freeze({
  visitCandidates: Object.freeze({file:TABLES.visitCandidates,id:'地点编号',headers:['地点编号','国家地区','到访城市/地点','证据','性质','说明','关联正文','核定状态','核定依据',...EVIDENCE_HEADERS]}),
  flightArchive: Object.freeze({file:TABLES.flightArchive,id:'证据编号',headers:FLIGHT_ARCHIVE_HEADERS}),
  ground: Object.freeze({ file: TABLES.ground, id: '交通编号', headers: GROUND_HEADERS }),
  japanPlaces: Object.freeze({ file: TABLES.places, id: '地点编号', headers: JAPAN_PLACE_HEADERS }),
  regionPlaces: Object.freeze({ file: TABLES.regionPlaces, id: '地点编号', headers: REGION_PLACE_HEADERS }),
  journeys: Object.freeze({ file: TABLES.journeys, id: '行程编号', headers: JOURNEY_HEADERS }),
  cityPlaces: Object.freeze({file:TABLES.cityPlaces,id:'地点编号',headers:CITY_PLACE_HEADERS,optional:true}),
  cityMoves: Object.freeze({file:TABLES.cityMoves,id:'移动编号',headers:CITY_MOVE_HEADERS,optional:true}),
  visits: Object.freeze({file:TABLES.visits,id:'到访编号',headers:VISIT_INSTANCE_HEADERS,optional:true}),
});

export function sourceHeaders(key) {
  const definition = UPDATE_DEFINITIONS[key];
  if (!definition) throw new Error(`未知维护表：${key}`);
  return definition.headers;
}
