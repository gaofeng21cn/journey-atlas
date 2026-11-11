import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {simplifyRing} from './display-geometry.mjs';

// Public catalog bounds only. Cache individual tiles instead of downloading
// entire country extracts for a new detail map; all renders remain offline.
export async function vectorContext(config,cache){
  const zoom=config.contextZoom||12,size=2**zoom,[w,s,e,n]=config.bounds;
  const tx=lon=>Math.floor((lon+180)/360*size),ty=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*size);
  const tiles=[],features=[],seen=new Set();
  for(let x=tx(w);x<=tx(e);x++)for(let y=ty(n);y<=ty(s);y++)tiles.push({x,y});
  const folder=join(cache,'openfreemap');await mkdir(folder,{recursive:true});
  const meta=await fetch('https://tiles.openfreemap.org/planet',{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw new Error('公共瓦片目录：'+r.status);return r.json();});
  const template=meta.tiles[0];let at=0;
  await Promise.all(Array.from({length:8},async()=>{while(at<tiles.length){const {x,y}=tiles[at++],path=join(folder,zoom+'-'+x+'-'+y+'.pbf');let bytes;
    try{bytes=await readFile(path);}catch{let error;for(let retry=0;retry<3;retry++)try{const r=await fetch(template.replace('{z}',zoom).replace('{x}',x).replace('{y}',y),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('地图瓦片：'+r.status);bytes=new Uint8Array(await r.arrayBuffer());break;}catch(e){error=e;}if(!bytes)throw error;await writeFile(path,bytes);}
    const tile=new VectorTile(new PbfReader(bytes));
    for(const layerName of ['transportation','waterway','water']){const layer=tile.layers[layerName];if(!layer)continue;
      for(let i=0;i<layer.length;i++){const raw=layer.feature(i),cls=raw.properties.class,water=layerName!=='transportation',rail=['rail','transit'].includes(cls),major=['motorway','trunk','primary'].includes(cls);
        if(!water&&!rail&&!major&&!['secondary','tertiary',...(zoom>=13?['minor','service','path']:[])].includes(cls))continue;
        const f=raw.toGeoJSON(x,y,zoom),kind=water?'water':rail?'rail':'road',geometry=f.geometry;
        const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'||geometry.type==='Polygon'?geometry.coordinates:geometry.type==='MultiPolygon'?geometry.coordinates.flat():[];
        for(const points of lines){if(points.length<2)continue;const key=kind+JSON.stringify(points);if(seen.has(key))continue;seen.add(key);
          features.push({type:'Feature',properties:{kind,major},geometry:{type:'LineString',coordinates:simplifyRing(points,zoom>=11?.000025:.00015)}});}
      }
    }
  }}));
  if(!features.length)throw new Error('公共背景为空：'+config.id);
  console.log(config.name+'公共矢量瓦片：'+tiles.length+'张，'+features.length+'条背景线');
  return {type:'FeatureCollection',source:'OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors',features};
}
