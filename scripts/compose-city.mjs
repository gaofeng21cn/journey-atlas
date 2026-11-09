import {pointInFeature} from './region-map.mjs';
import {greatCircleKm} from './travel-layers.mjs';
import {matchObservedPath,cityEvidenceRecord} from './city-evidence.mjs';
import {validatePlaceEvidence,validateMovementEvidence} from './evidence-contract.mjs';

const reviewFields=(item,kind)=>{
  const review=item.review||item;
  return {'核定结论':review.conclusion||'', '核定方式':review.reviewMethod||review.method||'',
    '证据引用':Array.isArray(review.evidenceReferences||review.references)?(review.evidenceReferences||review.references).join('；'):review.evidenceReferences||review.references||'',
    '核定记录':review.reviewRecord||review.record||''};
};
const checkReview=(row,kind)=>{
  const review=(kind==='place'?validatePlaceEvidence:validateMovementEvidence)(row,{city:true});
  if(!review.ok)throw new Error('城市编排须先完成明确核定：'+(row['地点编号']||row['移动编号'])+'；'+review.errors.join('；'));
};

// Curation supplies the meaning and order; machinery supplies references,
// district membership, timing estimates, evidence links and continuous edges.
export function composeCity({config,geometry,evidence,parentPlaceId,places,journeys}){
  const patch={version:1,cityPlaces:[],cityMoves:[],cityJourneys:[],cityEvidence:{}},observations=new Map();
  const clocks=new Map();
  for(const t of journeys){let order=0,last;
    const add=(date,aKey,bKey)=>{
      if(aKey===bKey)return;const a=places[aKey],b=places[bKey];if(!a||!b)throw new Error('行程引用未知编排节点');
      const coarse=a.level==='区域接续'||b.level==='区域接续',mode=coarse?'接续方式待核':t.modes?.[aKey+'>'+bKey]||t.mode||'市内交通',air=mode==='飞机',walking=mode==='步行',distance=greatCircleKm([a.lat,a.lon],[b.lat,b.lon]);
      const window=t.windows?.[date]?.[aKey+'>'+bKey]||{},lower=Math.max(window.windowStart??-Infinity,clocks.get(date)??-Infinity),match=coarse?null:matchObservedPath(evidence.tracks,date,[a.lat,a.lon],[b.lat,b.lon],{timeZone:config.timeZone,...window,...(Number.isFinite(lower)?{windowStart:lower}:{})});
      if(match)clocks.set(date,match.end);
      const modelKm=+Math.max(.1,distance*(air?1:walking?1.2:1.35)).toFixed(1),modelMinutes=Math.max(2,Math.round(air?modelKm/780*60+30:walking?modelKm/4.5*60:mode==='公路'?modelKm/65*60:mode==='轮渡'?modelKm/20*60+10:modelKm/20*60+5));
      const km=coarse?null:match?.km??modelKm,minutes=coarse?null:match?.minutes??modelMinutes;
      const row={'移动编号':t.id+'-'+String(++order).padStart(3,'0'),'城市编号':config.id,'行程编号':t.id,'日期':date,'段序':order,
        '出发地点编号':a.id,'到达地点编号':b.id,'交通方式':mode,'里程公里':km,'交通时长分钟':minutes,
        '里程依据':coarse?'起止位置未恢复，不计程':match?'匹配窗口内原始GPS样本累计距离，不叠加全局':'合理重构：代表点大圆距离×'+(air?'1.00':walking?'1.20':'1.35')+'，非实测导航公里，不叠加全局',
        '时长依据':coarse?'起止时刻未恢复，不计时长':match?'匹配GPS片段结束时间减开始时间，非游览/住宿时长':'交通方式模型，非游览/住宿时长','发生依据':t.basis||'',
        '关联正文':t.source,'路线几何经纬':match?JSON.stringify(match.points):'','路线几何依据':coarse?'仅记录区域接续，不表达精确起止位置':match?'同日单个连续GPS片段；方向与时间窗口匹配；起止偏差 '+match.startDistance.toFixed(3)+'/'+match.endDistance.toFixed(3)+' 公里':'合理连接，不冒充连续实测',
        '记录类型':coarse?'区域接续':t.recordType||'活动移动','计程纳入':coarse?'否':'是','里程类型':coarse?'unknown':match?'observed':'model','时长类型':coarse?'unknown':match?'observed':'model','线形类型':coarse?'unknown':match?'observed':'model',
        'GPS轨迹编号':match?.trackId||'','GPS开始时间':match?.start??'','GPS结束时间':match?.end??'',...reviewFields(t,'movement')};
      checkReview(row,'movement');patch.cityMoves.push(row);
    };
    for(const [date,keys]of t.days){if(last&&last!==keys[0])add(date,last,keys[0]);for(const key of keys){if(!observations.has(key))observations.set(key,[]);observations.get(key).push({date,source:t.source});}
      for(let i=1;i<keys.length;i++)add(date,keys[i-1],keys[i]);last=keys.at(-1);}
    patch.cityJourneys.push({id:t.id,cityId:config.id,name:t.name,first:t.days[0][0],last:t.days.at(-1)[0],source:t.source,parentPlaceId});
  }
  for(const [key,obs]of observations){const p=places[key],ward=geometry.features.find(f=>pointInFeature([p.lon,p.lat],f)),dates=[...new Set(obs.map(o=>o.date))].sort();
    const photos=evidence.photos.filter(s=>dates.includes(s.time_recorded?.slice(0,10))&&greatCircleKm([p.lat,p.lon],[s.lat,s.lon])<(p.radius||.6));
    if(p.visit&&!ward)throw new Error('已核到访点不在区界内：'+p.name);
    const row={'地点编号':p.id,'城市编号':config.id,'上级地点编号':parentPlaceId,'地点名称':p.name,'行政区代码':ward?.id||'','代表纬度':p.lat,'代表经度':p.lon,
      '到访状态':p.visit?'已到访':'交通节点','节点级别':p.level||(p.visit?'景区/街区':'交通接续'),'最早线索日':dates[0],'最晚线索日':dates.at(-1),'分享纳入':p.visit?'是':'否',
      '核定依据':p.basis||(p.visit?'实际回顾与照片定位联合核定':'进出接续，不证明旅游到访'),'照片来源关联编号':photos.map(s=>s.uuid).join('；'),'关联正文':[...new Set(obs.map(o=>o.source))].join('；'),
      '备注':'细化不增加全球城市数或总里程；相机时间、方式或确切基地未核部分保留合理推断',...reviewFields(p,'place')};
    checkReview(row,'place');patch.cityPlaces.push(row);
  }
  patch.cityEvidence[config.id]=cityEvidenceRecord(evidence,patch.cityJourneys,config.timeZone);
  return patch;
}
