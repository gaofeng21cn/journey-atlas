import {pointInFeature} from './region-map.mjs';
import {greatCircleKm} from './travel-layers.mjs';

// Geographic adapter shared by every detail scale. Transit never activates a
// visit. Airport endpoints retain their real position, not a city centroid.
export function atlasConnections(config,geo,atlas,places,{all=false}={}){
  const wardAt=(lat,lon)=>geo.features.find(f=>pointInFeature([lon,lat],f));
  const adapt=(r,i)=>{
    const ref=r.nodeRefs?.[i],display=(r.displayPoints||r.points)[i],actual=r.points[i];
    const parent=atlas.locationLayer.places.find(p=>p.id===(ref?.placeId||ref?.servicePlaceId));
    const country=ref?.country||parent?.country||(r.countries.length===r.points.length?r.countries[i]:r.countries.length===1?r.countries[0]:'');
    const coord=all?display:ref?.point||actual,[lat,lon]=coord,ward=country===config.country?wardAt(lat,lon):null;
    const near=ward&&places.find(p=>p.level!=='区域接续'&&greatCircleKm([p.lat,p.lon],coord)<(all?.01:2));
    if(near)return near;
    const formal=all&&places.find(p=>p.id===(ref?.placeId||ref?.servicePlaceId));if(formal&&ward)return formal;
    const name=(ward?(ref?.name||r.names[i]):ref?.displayName||(r.displayNames||r.names)[i]).replace(/\s*[（(][^（）()]*[）)]/g,'');
    return {id:ref?.id||'detail:'+config.id+':'+name,name,lat,lon,country,unitId:parent?.unitId||config.unitId,
      cityId:ward?config.id:null,districtId:ward?.id||null,visited:false,level:'交通接续'};
  };
  const routes=[];
  for(const r of atlas.routes){
    const nodes=r.points.map((_,i)=>adapt(r,i)),inside=nodes.map(n=>n.cityId===config.id);
    if(!inside.some(Boolean)||!all&&(inside.every(Boolean)||r.mode!=='飞机'))continue;
    routes.push({id:r.id,mode:r.mode,km:r.km,minutes:r.minutes||0,travelMinutes:r.travelMinutes,travelDurationBasis:r.travelDurationBasis,
      date:r.startDate||r.date,startDate:r.startDate,endDate:r.endDate,timePrecision:r.timePrecision,
      recordType:r.recordType,structuralLink:r.structuralLink||false,countDistance:r.countDistance!==false,countDuration:r.countDuration!==false,
      distanceType:r.distanceType||'unknown',durationType:r.durationType||'unknown',geometryType:r.geometryType||'display',
      durationBasis:r.durationBasis||'',globalConnection:true,nodes});
  }
  return routes;
}
export function mergeDetailConnections(detail,connections){
  const overlaps=(a,b)=>a.mode===b.mode&&a.date===b.date&&a.nodes.length===b.nodes.length&&a.nodes.every((n,i)=>n.country===b.nodes[i].country&&greatCircleKm([n.lat,n.lon],[b.nodes[i].lat,b.nodes[i].lon])<5);
  return [...detail,...connections.filter(r=>!detail.some(d=>overlaps(d,r)))];
}
