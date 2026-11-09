import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT} from './data.mjs';
import {simplifyRing} from './display-geometry.mjs';
import {geometryPoints} from '../src/geographic-fit.mjs';

// Public geography only. No personal records or coordinates are sent upstream.
const base='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const layers={countries:'ne_10m_admin_0_countries',regions:'ne_10m_admin_1_states_provinces',rivers:'ne_50m_rivers_lake_centerlines',lakes:'ne_50m_lakes',cities:'ne_10m_populated_places'};
const cache=join(ROOT,'data/site-cache/public-geography');await mkdir(cache,{recursive:true});
const simplify=g=>{const points=geometryPoints(g),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const tolerance=Math.min(.012,Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))/160);
  return {type:g.type,coordinates:g.type==='Point'?g.coordinates:g.type==='LineString'?simplifyRing(g.coordinates,tolerance):g.type==='Polygon'||g.type==='MultiLineString'?g.coordinates.map(r=>simplifyRing(r,tolerance)):g.coordinates.map(p=>p.map(r=>simplifyRing(r,tolerance)))};};
const result={source:'Natural Earth · public domain',sourceUrl:'https://www.naturalearthdata.com/about/terms-of-use/',layers:{}};
await Promise.all(Object.entries(layers).map(async([kind,name])=>{
  const file=join(cache,name+'.geojson');let geo;
  try{geo=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const response=await fetch(base+name+'.geojson');if(!response.ok)throw new Error(name+' '+response.status);geo=await response.json();await writeFile(file,JSON.stringify(geo));}
  result.layers[kind]={type:'FeatureCollection',features:geo.features.filter(f=>kind!=='cities'||f.properties.POP_MAX>=50000).map(f=>{
    const p=f.properties,code=p.ISO_A2_EH||p.ISO_A2||p.iso_a2||p.ISO_A2||'',a3=p.ADM0_A3||p.adm0_a3||p.ADM0_A3||'';
    return {type:'Feature',id:p.adm1_code||a3||p.ne_id,properties:{code,a3,name:p.NAME_ZH||p.name_zh||p.NAME||p.name||'',rank:p.SCALERANK??p.scalerank??5,population:p.POP_MAX||0},geometry:simplify(f.geometry)};
  })};console.log(kind,result.layers[kind].features.length);
}));
await writeFile(join(ROOT,'data/geographic-context.json'),JSON.stringify(result));
