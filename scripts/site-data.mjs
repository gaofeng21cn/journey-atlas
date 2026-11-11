import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {feature} from 'topojson-client';
import iso from 'i18n-iso-countries';
import {ROOT,WORKSPACE_ROOT,readJson} from './data.mjs';
import {loadAtlas} from './atlas-data.mjs';
import {pointInFeature} from './region-map.mjs';
import {boundsOf} from '../src/scope-model.mjs';
import {displayGeometry} from './display-geometry.mjs';
import {sampleMapDots} from '../src/map-dots.mjs';
import {canonicalName,greatCircleKm} from './travel-layers.mjs';
import {loadCityDetails} from './city-data.mjs';
import {countryDisplay} from '../src/geographic-fit.mjs';
import {describeMovement} from '../src/route-semantics.mjs';
import {resolveSource,readAtlasConfig} from './source-data.mjs';

const cleanName=n=>String(n||'').replace(/[（(][^（）()]*[）)]$/,'');

// Browser data is a drawing projection, never a second evidence archive. Use a
// whitelist so future source fields cannot leak through nested route nodes.
const selectFields=(object,fields)=>Object.fromEntries(fields.filter(k=>object?.[k]!==undefined).map(k=>[k,object[k]]));
const displayNode=p=>selectFields(p,['id','name','serviceName','country','unitId','lat','lon','cityId','districtId','active','visited','parentId','level']);
export function displayCityDetails(cities){
  return Object.fromEntries(Object.entries(cities).map(([id,city])=>[id,{
    places:city.places.map(displayNode),
    routes:city.routes.map(r=>({...selectFields(describeMovement(r),['id','mode','vehicle','sourceMode','movementExtent','metricOwnerIds','km','minutes','travelMinutes','date','startDate','endDate','timePrecision','order','tripId','recordType','structuralLink','countDistance','countDuration','distanceType','durationType','geometryType','candidate','occurrenceStatus','path']),nodes:r.nodes.map(displayNode)})),
    inferredRoutes:(city.inferredRoutes||[]).map(r=>({...selectFields(describeMovement(r),['id','mode','vehicle','sourceMode','movementExtent','km','minutes','travelMinutes','date','startDate','endDate','order','tripId','recordType','countDistance','countDuration','distanceType','durationType','geometryType','occurrenceStatus','path','sourceKind','confidence','distanceRange','durationRange','reconstructed']),nodes:r.nodes.map(displayNode)})),
    reconstruction:city.reconstruction?{version:city.reconstruction.version,summary:city.reconstruction.summary}:null,
    trips:city.trips.map(t=>selectFields(t,['id','name','cityId','first','last'])),
    tracks:(city.tracks||[]).map(t=>({...selectFields(t,['date','points','samples']),timed:Boolean(t.start&&t.end)})),
    photoPoints:(city.photoPoints||[]).map(p=>selectFields(p,['date','lat','lon'])),
    evidence:selectFields(city.evidence,['footprintInside','usableGps','photos','tracks','retainedTracks','activityTracks','curatedTrips','recordedDays']),
    parentPlaceIds:city.parentPlaceIds||[]
  }]));
}

export async function prepareSiteData({vault,atlas,onCityDetails}={}) {
  const config=await readAtlasConfig();
  const source=await resolveSource({vault,config});
  atlas ||= (await loadAtlas(vault,{}, {source})).atlas;
  const detail=await loadCityDetails(source.folder,atlas,{},source);
  if(onCityDetails)await onCityDetails(detail);
  const [catalog,prefs,topology,dotText,worldTopo,locale,hierarchy,publicGeography,geocodeCache]=await Promise.all([
    readJson(join(ROOT,'data/region-catalog.json')),readJson(join(ROOT,'data/japan-prefectures.json')),
    readJson(join(ROOT,'data/japan.topojson')),readFile(join(ROOT,'src/world-dots.js'),'utf8'),
    readJson(join(ROOT,'node_modules/world-atlas/countries-110m.json')),readJson(join(ROOT,'node_modules/i18n-iso-countries/langs/zh.json')),
    readJson(join(ROOT,'data/scope-hierarchy.json')),readJson(join(ROOT,'data/geographic-context.json')),
    readJson(join(WORKSPACE_ROOT,'data/geocode-cache.json')).catch(()=>({}))]);
  iso.registerLocale(locale);
  const countryName=new Map(Object.entries(iso.getAlpha2Codes()).filter(([code])=>code!=='XK').map(([code])=>[code,iso.getName(code,'zh')]));
  for(const p of atlas.locationLayer.places)if(p.countryCode)countryName.set(p.countryCode,p.country);
  for(const u of catalog.europe.units)if(u.id!=='XK')countryName.set(u.id,u.name);
  for(const [code,name]of Object.entries({HK:'中国香港',MO:'中国澳门',TW:'中国台湾',KR:'韩国',KP:'朝鲜',VA:'梵蒂冈',SG:'新加坡'}))countryName.set(code,name);
  const codeOf=p=>countryName.has(p.code)?p.code:iso.alpha3ToAlpha2(p.a3);
  const publicCountries=new Map();
  for(const f of publicGeography.layers.countries.features){const code=codeOf(f.properties),name=countryName.get(code);if(!name)continue;
    if(!publicCountries.has(name)||f.properties.a3===iso.alpha2ToAlpha3(code))publicCountries.set(name,f);}
  const dots=JSON.parse(dotText.slice(dotText.indexOf('=')+1).trim().replace(/;$/,''));
  const countries=[...new Set([...countryName.values(),...atlas.countries.map(c=>c.name)])].sort();
  const parentByCountry=new Map();
  for(const r of hierarchy.regions)for(const code of r.codes.split(' ')){
    const name=countryName.get(code);if(name)parentByCountry.set(name,r.id);
  }
  // The subregion takes precedence over its containing continent.
  for(const name of catalog['southeast-asia'].countries)parentByCountry.set(name,'southeast-asia');
  for(const name of catalog.europe.countries)parentByCountry.set(name,'europe');
  const geometries=Object.fromEntries(await Promise.all(Object.entries(catalog).map(async([key,c])=>[key,await readJson(join(ROOT,'data',c.file))])));
  geometries.japan=feature(topology,topology.objects.japan);
  for(const f of geometries.japan.features)f.id='JP-'+String(f.properties.id).padStart(2,'0');
  geometries.world=feature(worldTopo,worldTopo.objects.countries);
  for(const f of geometries.world.features)f.id=countryName.get(iso.numericToAlpha2(f.id))||f.properties.name;
  const publicCatalog={...catalog,japan:{name:'日本',english:'JAPAN',countries:['日本'],bounds:[122,24,147,46],
    units:prefs.map(([id,name,native,group])=>({id:'JP-'+id,name,native,group,counted:true})),unitLabel:'到访都道府县',source:topology.attribution||'地球地図日本 / dataofjapan'}};
  const places=atlas.locationLayer.places.filter(p=>p.include).map(p=>({id:p.id,name:cleanName(p.name),country:p.country,
    unitId:p.prefectureId?'JP-'+p.prefectureId:p.unitId,lat:p.lat,lon:p.lon,
    active:p.status==='已到访'||p.status==='计划'&&catalog.europe.includePlans&&catalog.europe.countries.includes(p.country),
    // Preserve the fact status in the private runtime; the presentation does not
    // split planned and completed visits.
    level:p.level,first:p.first,last:p.last}));
  const placeIndex=new Map(places.map(p=>[p.id,p]));
  const countryMaps=Object.entries(publicCatalog).filter(([id])=>!['europe','southeast-asia'].includes(id));
  const unitOf=(country,point)=>{
    const entry=countryMaps.find(([,c])=>c.countries.includes(country));if(!entry)return '';
    const geo=geometries[entry[0]];
    return geo.features.find(f=>pointInFeature([point[1],point[0]],f))?.id||'';
  };
  const node=(ref,name,point,country,serviceName='')=>{
    const p=placeIndex.get(ref?.placeId)||placeIndex.get(ref?.servicePlaceId);
    const actualCountry=p?.country||(ref?.country&&!ref.country.includes('；')?ref.country:country);
    return {id:ref?.id||`${actualCountry}|${name}|${point.join(',')}`,name:cleanName(canonicalName(ref?.displayName||name,atlas.journeyLayer.aliases)),serviceName:cleanName(canonicalName(serviceName,atlas.journeyLayer.aliases)),
      country:actualCountry,unitId:p?.unitId||unitOf(actualCountry,point),lat:point[0],lon:point[1],visited:p?.active||false};
  };
  const routes=atlas.routes.filter(r=>r.recordType!=='节点对应').map(r=>({id:r.id,mode:r.mode,vehicle:r.vehicle,sourceMode:r.sourceMode,movementExtent:r.movementExtent,cities:r.cities,metricOwnerIds:r.metricOwnerIds,km:r.km,minutes:r.minutes??null,durationBasis:r.durationBasis||'',travelMinutes:r.travelMinutes,travelDurationBasis:r.travelDurationBasis,date:r.startDate||r.date,
    startDate:r.startDate,endDate:r.endDate,timePrecision:r.timePrecision,recordType:r.recordType,structuralLink:r.structuralLink||false,countDistance:r.countDistance!==false,countDuration:r.countDuration!==false,
    distanceType:r.distanceType||'unknown',durationType:r.durationType||'unknown',geometryType:r.geometryType||'display',occurrenceStatus:r.review?.conclusion||r.status,
    nodes:(r.displayPoints||r.points).map((point,i)=>node(r.nodeRefs?.[i],(r.displayNames||r.names)[i],point,r.countries.length===r.points.length?r.countries[i]:r.countries.length===1?r.countries[0]:'',r.cities?.[i]||''))}));
  const routeNodes=routes.flatMap(r=>r.nodes);
  for(const h of atlas.hubLinks.filter(h=>!h.covered))routes.push({id:h.id,mode:h.mode,km:null,minutes:null,date:h.startDate||h.date,
    startDate:h.startDate,endDate:h.endDate,timePrecision:h.timePrecision,candidate:true,countDistance:false,countDuration:false,distanceType:'unknown',durationType:'unknown',geometryType:'display',occurrenceStatus:'待还原',
    nodes:[h.from,h.to].map((point,i)=>{
      const name=cleanName(canonicalName(i?h.toName:h.fromName,atlas.journeyLayer.aliases));
      const matches=p=>cleanName(canonicalName(p.name,atlas.journeyLayer.aliases))===name&&greatCircleKm(point,[p.lat,p.lon])<=10;
      const known=routeNodes.find(p=>p.country&&matches(p));
      const p=atlas.locationLayer.places.find(p=>p.lat!==null&&p.lon!==null&&matches(p));
      const ref={id:i?h.toNodeId:h.fromNodeId,country:known?.country||p?.country||''};
      return node(ref,name,point,known?.country||p?.country||'');
    })});
  const scopes=[{id:'world',name:'全球',english:'WORLD',parent:null,level:'world',countries,units:countries.map(name=>({id:name,name})),
    bounds:[-180,-58,180,84],coverage:atlas.countries.map(c=>c.name),unitLabel:'国家与地区',source:'Natural Earth · ISO 3166-1 国家与地区'}];
  for(const r of hierarchy.regions.filter(r=>!publicCatalog[r.id])){
    const names=r.codes.split(' ').map(code=>countryName.get(code)).filter(Boolean);
    scopes.push({...r,level:'macro',countries:names,units:names.map(name=>({id:name,name})),unitLabel:'国家与地区',source:'Natural Earth'});
  }
  const configuredCountries=new Map();
  for(const [id,c]of Object.entries(publicCatalog)){
    const isCountry=!['europe','southeast-asia'].includes(id),parent=isCountry?parentByCountry.get(c.countries[0])||'world':hierarchy.regions.find(r=>r.id===id)?.parent||'world';
    scopes.push({id,name:c.name,english:c.english,parent,level:isCountry?'country':'macro',countries:c.countries,
      units:c.units,bounds:c.bounds,unitLabel:c.unitLabel|| (isCountry?'行政区':'国家与地区'),source:c.source,
      insets:c.insets,step:c.step,labels:c.labels,
      coverage:!isCountry&&c.activeFromCoverage?atlas.regions[id].units.filter(u=>u.active).map(u=>u.id):undefined});
    // Macro scopes use country names as identities, regardless of ISO display
    // IDs in the older catalog. This keeps visit evidence separate from transit.
    if(!isCountry)scopes.at(-1).units=c.units.map(u=>({...u,mapId:u.id,id:u.name}));
    if(!isCountry&&c.activeFromCoverage)scopes.at(-1).coverage=atlas.regions[id].units.filter(u=>u.active).map(u=>u.name);
    if(isCountry){configuredCountries.set(c.countries[0],id);
      for(const u of c.units){const f=geometries[id].features.find(f=>f.id===u.id),pts=f?geometryPoints(f.geometry):[];
        scopes.push({id:'unit:'+u.id,name:u.name,english:u.native||u.id,parent:id,level:'unit',unitId:u.id,countries:c.countries,units:[],
          bounds:boundsOf(pts.map(([lon,lat])=>[lat,u.id==='US-AK'&&lon>0?lon-360:lon]),.025,0),geometryParent:id,unitLabel:'城市 / 地点',source:c.source});}}
  }
  for(const country of countries){if(configuredCountries.has(country))continue;
    const id='country:'+country,parent=parentByCountry.get(country)||'world';
    const f=publicCountries.get(country)||geometries.world.features.find(f=>f.id===country),points=f?geometryPoints(f.geometry).map(([lon,lat])=>[lat,lon]):dots.filter(p=>p[2]===country).map(([lon,lat])=>[lat,lon]);
    const display=f&&places.some(p=>p.country===country&&p.active)?countryDisplay({...f,id:country},[...places,...routes.flatMap(r=>r.nodes)].filter(p=>p.country===country)):null;
    if(display)geometries[id]=display.geometry;
    scopes.push({id,name:country,english:country,parent,level:'country',countries:[country],units:[],bounds:display?.frames[0].bounds||boundsOf(points,.025,0),displayFrames:display?.frames,unitLabel:'城市 / 地点',source:'Natural Earth · 1:10m / 1:50m'});
    configuredCountries.set(country,id);
  }
  for(const s of scopes.filter(s=>s.level==='country'&&!s.units.length)){
    s.units=places.filter(p=>p.country===s.countries[0]).map(p=>({id:p.id,name:p.name}));s.placeCoverage=true;
  }
  for(const s of scopes.filter(s=>s.level==='country'&&!s.displayFrames&&!s.insets?.length&&s.id!=='japan')){
    const geo=geometries[s.id];if(geo)s.bounds=boundsOf(geo.features.flatMap(f=>geometryPoints(f.geometry)).map(([lon,lat])=>[lat,lon]),.025,0);
  }
  const descendants=id=>scopes.filter(s=>s.parent===id).flatMap(s=>s.level==='country'?s.countries:s.level==='macro'?descendants(s.id):[]);
  for(const s of scopes.filter(s=>s.level==='macro')){
    s.countries=[...new Set(descendants(s.id))];
    if(!publicCatalog[s.id])s.units=s.countries.map(name=>({id:name,name}));
  }
  // Public backdrop is separate from the visited-place and coverage models.
  const usedCodes=new Set(places.filter(p=>p.active).map(p=>[...countryName].find(([,n])=>n===p.country)?.[0]));
  const background={source:publicGeography.source,regions:publicGeography.layers.regions.features.filter(f=>usedCodes.has(codeOf(f.properties))),cities:publicGeography.layers.cities.features.filter(f=>usedCodes.has(codeOf(f.properties))),rivers:publicGeography.layers.rivers.features,lakes:publicGeography.layers.lakes.features};
  for(const s of scopes)s.backgroundCodes=s.countries.map(n=>[...countryName].find(([,name])=>name===n)?.[0]).filter(Boolean);
  // Reduced display payload: no source-note links, tickets, evidence or original
  // GPS/photo records cross into the browser. No duplicated regional routes.
  const mapDots=Object.fromEntries(scopes.filter(s=>geometries[s.id]&&s.id!=='world').map(s=>[s.id,sampleMapDots(s,geometries[s.id])]));
  // A city-state or Tokyo's duplicate prefecture entry opens its city map
  // directly. Keep underlying administrative identities for old URLs/maps.
  for(const city of detail.scopes.filter(s=>s.level==='city'))for(const id of city.entryScopes||[]){
    const entry=[...scopes,...detail.scopes].find(s=>s.id===id);if(!entry)throw new Error('城市默认入口不存在：'+id);
    entry.detailScopeId=city.id;
    if(city.parent===id)city.parent=entry.parent;
  }
  const gatewayCatalog=Object.entries(geocodeCache).flatMap(([key,value])=>{
    const [name,country]=key.split('|');
    return Number.isFinite(value?.lat)&&Number.isFinite(value?.lon)?[{name,canonical:name,country,lat:value.lat,lon:value.lon}]:[];
  });
  // Add physical transport endpoints with their service-city identity. City
  // maps retain the airport/station coordinate for the line, while the edge
  // label is resolved to the city instead of splitting Hongqiao/Pudong or
  // Baiyun into separate gateways. This is a display catalogue only; source
  // route nodes remain unchanged.
  const gatewayKeys=new Set(gatewayCatalog.map(c=>[c.name,c.country,c.lat,c.lon].join('|')));
  for(const r of atlas.routes)for(const [i,name] of (r.names||[]).entries()){
    const point=r.points?.[i],canonical=r.cities?.[i],country=r.countries?.[i];
    if(!canonical||!Array.isArray(point)||point.length!==2||!Number.isFinite(point[0])||!Number.isFinite(point[1]))continue;
    const key=[name,country,point[0],point[1]].join('|');if(gatewayKeys.has(key))continue;gatewayKeys.add(key);
    gatewayCatalog.push({name,canonical,country,lat:point[0],lon:point[1]});
  }
  // A generic GPS endpoint can be an airport, a bus terminal or a city edge
  // whose source row has no city name.  Add only the public backdrop's larger
  // cities as a deterministic reverse-geocoding catalogue.  The renderer
  // applies a tighter radius to these entries, so a remote scenic point is
  // never promoted to a made-up city gateway.
  for(const f of publicGeography.layers.cities.features){
    const p=f.properties||{},point=f.geometry?.coordinates;
    const country=countryName.get(p.code);
    if(!country||!Array.isArray(point)||point.length!==2||!(p.population>=100000||p.rank<=8))continue;
    const [lon,lat]=point,name=cleanName(p.name);if(!name||!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const key=[name,country,lat,lon].join('|');if(gatewayKeys.has(key))continue;gatewayKeys.add(key);
    gatewayCatalog.push({name,canonical:name,country,lat,lon,source:'public-city',population:p.population||0});
  }
  return {version:2,generatedAt:new Date().toISOString(),meta:atlas.meta,countries:atlas.countries,scopes:[...scopes,...detail.scopes],places,routes,dots,mapDots,background,gatewayCatalog,cities:displayCityDetails(detail.cities),contexts:detail.contexts,
    geometries:{...Object.fromEntries(Object.entries(geometries).map(([id,geo])=>[id,displayGeometry(geo)])),...detail.geometries}};
}

function geometryPoints(g){return g.type==='Polygon'?g.coordinates.flat():g.coordinates.flat(2);}
