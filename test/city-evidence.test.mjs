import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {matchObservedPath,cityDate,collectCityEvidence,collectCitiesEvidence,cityEvidenceRecord} from '../scripts/city-evidence.mjs';
import {greatCircleKm} from '../scripts/travel-layers.mjs';

const date='2030-04-10',origin=Date.parse(date+'T03:00:00Z')/1000;
function track(points,offsets=points.map((_,i)=>i*120)){
  return {id:'gps:test',date,timeZone:'Asia/Tokyo',start:origin+offsets[0],end:origin+offsets.at(-1),points,
    sampleTimes:offsets.map(s=>origin+s),sampleAccuracies:points.map(()=>20),samples:points.length};
}
function length(points){return points.slice(1).reduce((km,p,i)=>km+greatCircleKm([points[i][1],points[i][0]],[p[1],p[0]]),0);}

test('尚未写成活动的定位与照片完整保留，不能被活动窗口筛掉',()=>{
  const tracks=[{date:'2024-01-01',id:'ACTIVITY'},{date:'2025-01-01',id:'UNWRITTEN'}],stays=[{date:'2025-01-01'}];
  const evidence=cityEvidenceRecord({tracks,stays,summary:{usableGps:3000},photos:[{uuid:'PHOTO',time_utc:'2025-02-01T17:00:00Z',time_recorded:'2025-02-01',lat:23,lon:113}]},[{first:'2024-01-01',last:'2024-01-01'}],'Asia/Shanghai');
  assert.deepEqual(evidence.tracks,tracks);assert.deepEqual(evidence.stays,stays);
  assert.equal(evidence.summary.retainedTracks,2);assert.equal(evidence.summary.activityTracks,1);assert.equal(evidence.summary.recordedDays,3);
  assert.equal(evidence.photoPoints[0].date,'2025-02-02');assert.equal(evidence.photoPoints[0].uuid,'PHOTO');
});

test('任意城市批量采集共读一次来源，按目录边界分别生成完整证据',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'travel-passport-batch-'));
  try{
    const photosPath=join(directory,'photos.json'),footprintPath=join(directory,'footprint.csv');
    await writeFile(photosPath,JSON.stringify([{uuid:'P1',gps_valid:true,lat:35.5,lon:139.5,time_utc:'2024-01-01T00:00:00Z'},{uuid:'P2',gps_valid:true,lat:31.5,lon:121.5,time_utc:'2024-01-01T00:00:00Z'}]));
    const rows=[[35.5,139.5,origin,10],[35.51,139.51,origin+120,10],[31.5,121.5,origin,10],[31.51,121.51,origin+120,10]];
    await writeFile(footprintPath,'latitude,longitude,dataTime,accuracy,speed\n'+rows.map(r=>r.join(',')).join('\n'));
    const polygon=(w,s,e,n)=>({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}}]});
    const result=await collectCitiesEvidence({photosPath,footprintPath,cities:[{id:'tokyo',timeZone:'Asia/Tokyo',geometry:polygon(139,35,140,36)},{id:'shanghai',timeZone:'Asia/Shanghai',geometry:polygon(121,31,122,32)}]});
    assert.equal(result.tokyo.summary.footprintInside,2);assert.equal(result.shanghai.summary.footprintInside,2);
    assert.equal(result.tokyo.summary.photos,1);assert.equal(result.shanghai.summary.photos,1);
    assert.equal(result.tokyo.summary.usableGps,2);assert.equal(result.shanghai.summary.usableGps,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('城市归日遵循各地时区，不把港新晚间误归为东京次日',()=>{
  const time=Date.parse('2031-02-12T15:30:00Z')/1000;
  assert.equal(cityDate(time,'Asia/Tokyo'),'2031-02-13');
  assert.equal(cityDate(time,'Asia/Hong_Kong'),'2031-02-12');
  assert.equal(cityDate(time,'Asia/Singapore'),'2031-02-12');
});
test('定位线形只能按同日、正确方向的单个连续片段匹配，不跨断档拼接',()=>{
  const a=[30.00,20.00],b=[30.00,20.02],forward=track([[20.00,30.00],[20.01,30.00],[20.02,30.00]]);
  const match=matchObservedPath([forward],date,a,b);
  assert.deepEqual(match.points,forward.points);assert.equal(match.trackId,forward.id);assert.equal(match.direction,'forward');
  assert.equal(match.start,origin);assert.equal(match.end,origin+240);assert.equal(match.minutes,4);assert.equal(match.samples,3);assert.equal(match.accuracy,20);
  assert.equal(match.startDistance,0);assert.equal(match.endDistance,0);assert.equal(match.km,length(forward.points));
  assert.equal(matchObservedPath([forward],date,b,a),null);
  assert.equal(matchObservedPath([forward],'2030-04-11',a,b),null);
  assert.equal(matchObservedPath([track(forward.points.slice(0,2)),track(forward.points.slice(1))],date,a,b),null);
  assert.equal(matchObservedPath([{date,points:forward.points}],date,a,b),null);
});
test('重复、逆序、跨日与900秒以上的采样断档不能晋级连续实测',()=>{
  const a=[30.00,20.00],b=[30.00,20.02],points=[[20.00,30.00],[20.01,30.00],[20.02,30.00]];
  for(const offsets of [[0,120,120],[0,120,60],[0,1000,1120],[0,120,86400]])assert.equal(matchObservedPath([track(points,offsets)],date,a,b),null);
  const inconsistent=track(points);inconsistent.start++;
  assert.equal(matchObservedPath([inconsistent],date,a,b),null);
  assert.equal(matchObservedPath([{...track(points),sampleAccuracies:[]}],date,a,b),null);
});
test('简化后的长时间跨度用原始区间最大采样间隔判断连续，不凭总样本数绕过断档',()=>{
  const a=[30.00,20.00],b=[30.00,20.02],points=[[20.00,30.00],[20.02,30.00]],observed={...track(points,[0,1200]),
    samples:11,sampleIndices:[0,10],sampleIntervalMaxGaps:[0,120],sampleCumulativeKm:[0,length(points)]};
  const match=matchObservedPath([observed],date,a,b);
  assert.ok(match);assert.equal(match.minutes,20);assert.equal(match.samples,11);assert.equal(match.km,length(points));
  assert.equal(matchObservedPath([{...observed,sampleIntervalMaxGaps:[0,1000]}],date,a,b),null);
  assert.equal(matchObservedPath([{...observed,sampleIntervalMaxGaps:undefined}],date,a,b),null);
  assert.equal(matchObservedPath([{...observed,sampleIndices:undefined}],date,a,b),null);
  assert.equal(matchObservedPath([{...observed,sampleIntervalMaxGaps:[0,20]}],date,a,b),null);
});
test('相距100米的邻点容差不重叠，也不捞取同日1.6公里长环线',()=>{
  const a=[30.00,20.00],b=[30.00,20.0011];
  const overlapping=track([[20.00055,30.00],[20.01,30.00],[20.00055,30.00]],[0,300,600]);
  assert.ok(length(overlapping.points)>1.6);
  assert.equal(matchObservedPath([overlapping],date,a,b,.35),null);
  const loop=track([[20.00,30.00],[20.01,30.00],[20.0011,30.00]],[0,300,600]);
  assert.equal(matchObservedPath([loop],date,a,b),null);
  assert.ok(matchObservedPath([loop],date,a,b,{windowStart:origin,windowEnd:origin+600}));
  assert.ok(matchObservedPath([track([[20.00,30.00],[20.00055,30.00],[20.0011,30.00]])],date,a,b));
});
test('实测端点偏差单独保留，不画到代表点、不增添虚构公里与时间',()=>{
  const a=[30.00,20.00],b=[30.00,20.02],observed=track([[20.0001,30.00],[20.01,30.00],[20.0199,30.00]]);
  const match=matchObservedPath([observed],date,a,b);
  assert.deepEqual(match.points,observed.points);assert.ok(match.startDistance>0&&match.endDistance>0);
  assert.equal(match.km,length(observed.points));assert.ok(match.km<greatCircleKm(a,b));assert.equal(match.minutes,4);
  const far=track([[20.002,30.00],[20.01,30.00],[20.018,30.00]]);
  far.sampleAccuracies=[100,100,100];
  assert.equal(matchObservedPath([far],date,a,b,{radius:100}),null);
});
test('明确时间窗约束匹配片段，不使用窗口外的到达或离开样本',()=>{
  const a=[30.00,20.00],b=[30.00,20.02],observed=track([[20.00,30.00],[20.01,30.00],[20.02,30.00],[20.03,30.00]]);
  assert.ok(matchObservedPath([observed],date,a,b,{windowStart:origin,windowEnd:origin+240}));
  assert.equal(matchObservedPath([observed],date,a,b,{windowStart:origin+120,windowEnd:origin+360}),null);
  assert.equal(matchObservedPath([observed],date,a,b,{windowEnd:origin+120}),null);
  assert.equal(matchObservedPath([observed],date,a,b,{windowStart:origin+240,windowEnd:origin+120}),null);
  assert.equal(matchObservedPath([observed],date,a,b,{windowStart:NaN}),null);
});
test('采集简化轨迹保留逐点时间、精度和原始累计公里，匹配统计来自同一真实片段',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'travel-passport-gps-'));
  try{
    const geometry={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[19.99,29.99],[20.05,29.99],[20.05,30.01],[19.99,30.01],[19.99,29.99]]]}}]};
    const raw=Array.from({length:24},(_,i)=>({time:origin+i*120,lat:30.00+(i%2? .00005:0),lon:20.00+i*.001,accuracy:i===1?99:10+i%5}));
    const photosPath=join(directory,'photos.json'),footprintPath=join(directory,'footprint.csv');
    await writeFile(photosPath,'[]');
    await writeFile(footprintPath,'latitude,longitude,dataTime,accuracy,speed\n'+raw.map(p=>[p.lat,p.lon,p.time,p.accuracy,0].join(',')).join('\n'));
    const evidence=await collectCityEvidence({photosPath,footprintPath,geometry});
    assert.equal(evidence.tracks.length,1);const observed=evidence.tracks[0];
    assert.ok(observed.id.startsWith('gps:'));assert.equal(observed.start,raw[0].time);assert.equal(observed.end,raw.at(-1).time);
    assert.ok(observed.points.length<raw.length);assert.equal(observed.samples,raw.length);
    for(const [i,index]of observed.sampleIndices.entries()){
      assert.deepEqual(observed.points[i],[raw[index].lon,raw[index].lat]);assert.equal(observed.sampleTimes[i],raw[index].time);assert.equal(observed.sampleAccuracies[i],raw[index].accuracy);
      assert.ok(!i||observed.sampleTimes[i]-observed.sampleTimes[i-1]<=900);
      assert.equal(observed.sampleIntervalMaxGaps[i],i?120:0);
    }
    const a=[raw[0].lat,raw[0].lon],b=[raw.at(-1).lat,raw.at(-1).lon],match=matchObservedPath(evidence.tracks,date,a,b);
    assert.ok(match);assert.equal(match.start,observed.start);assert.equal(match.end,observed.end);assert.equal(match.samples,raw.length);
    assert.equal(match.minutes,(raw.at(-1).time-raw[0].time)/60);assert.equal(match.km,length(raw.map(p=>[p.lon,p.lat])));assert.equal(match.accuracy,99);
    assert.ok(match.km>length(match.points));
    const startIndex=2,endIndex=observed.points.length-2,start=observed.sampleIndices[startIndex],end=observed.sampleIndices[endIndex];
    const part=matchObservedPath(evidence.tracks,date,[raw[start].lat,raw[start].lon],[raw[end].lat,raw[end].lon],{windowStart:raw[start].time,windowEnd:raw[end].time});
    assert.ok(part);assert.equal(part.km,observed.sampleCumulativeKm[endIndex]-observed.sampleCumulativeKm[startIndex]);
    assert.equal(part.samples,end-start+1);assert.equal(part.minutes,(raw[end].time-raw[start].time)/60);
  }finally{await rm(directory,{recursive:true,force:true});}
});
