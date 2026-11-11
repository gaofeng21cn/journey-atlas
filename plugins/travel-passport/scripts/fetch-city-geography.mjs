import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT,WORKSPACE_ROOT} from './data.mjs';
import {displayGeometry} from './display-geometry.mjs';
import {spawnSync} from 'node:child_process';
import {vectorContext} from './vector-context.mjs';

// Only public catalogue bounds are sent to map providers, never personal data.
const configs=JSON.parse(await readFile(join(ROOT,'data/city-catalog.json'),'utf8'));
const selected=process.argv.slice(2).filter(v=>!v.startsWith('--'));
const get=async url=>{let last;for(let attempt=0;attempt<2;attempt++)try{const r=await fetch(url,{headers:{'User-Agent':'TravelPassport/0.1 (local offline city map; public geography only)'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(url+'：'+r.status);return await r.json();}catch(e){last=e;}
  const fallback=spawnSync('curl',['-fsSL','--retry','2','--max-time','60',url],{encoding:'utf8',maxBuffer:30*1024*1024});if(fallback.status===0)return JSON.parse(fallback.stdout);throw last;};
for(const c of configs.filter(c=>!selected.length||selected.includes(c.id))){
  let existing;try{existing=JSON.parse(await readFile(join(ROOT,'data',c.boundaryFile),'utf8'));}catch{}
  if(existing?.features?.length===c.expectedUnits&&c.unitNames&&!existing.features.every(f=>f.properties?.name)){
    for(const f of existing.features){const name=c.unitNames[f.id.slice(c.id.length+1)];if(!name)throw new Error('行政区代码未登记：'+f.id);f.properties={name,native:name,english:name};}
    await writeFile(join(ROOT,'data',c.boundaryFile),JSON.stringify(existing));
  }
  if(c.landMaskFile){
    const filename='ne_10m_admin_0_countries.geojson',rawPath=join(ROOT,'data/site-cache/public-geography',filename);
    let source;try{source=JSON.parse(await readFile(rawPath,'utf8'));}catch{source=await get('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'+filename);}
    const land=source.features.find(f=>(f.properties.ISO_A2_EH||f.properties.ISO_A2)===c.landMaskCountryCode);if(!land)throw new Error('城市海岸源缺失：'+c.id);
    // Keep original 10m coastline resolution at city scale, not the global
    // display simplification. This is public geometry, no private points.
    await writeFile(join(ROOT,'data',c.landMaskFile),JSON.stringify({type:'Feature',properties:{source:'Natural Earth 1:10m'},geometry:land.geometry}));
  }
  if(process.argv.includes('--refresh')||!existing?.features?.every(f=>f.properties?.name)){
  const files=await Promise.all((c.boundaryUrls||[c.boundaryUrl]).map(get));
  const fields=c.boundaryFields||{id:'code',name:'ward_ja',english:'ward_en'};
  const names={'渋谷区':'涩谷区','練馬区':'练马区','豊島区':'丰岛区','目黒区':'目黑区','台東区':'台东区','江東区':'江东区','葛飾区':'葛饰区',...c.names};
  const features=files.flatMap(g=>g.features).filter(f=>c.boundaryFilter?Object.entries(c.boundaryFilter).every(([k,v])=>f.properties[k]===v):c.id==='tokyo'?f.properties.area_ja==='都区部':true).map(f=>{
    const p=f.properties,native=String(p[fields.name]),id=String(p[fields.id]).slice(0,c.id==='tokyo'?5:100);
    return {...f,id:c.id+'-'+id,properties:{name:names[native]||native,native,english:String(p[fields.english]||native)}};
  });
  if(features.length!==(c.expectedUnits||23)||new Set(features.map(f=>f.id)).size!==features.length)throw new Error(c.name+'行政单元数或身份不符');
  const display=displayGeometry({type:'FeatureCollection',features});display.features.forEach((f,i)=>f.properties=features[i].properties);
  await writeFile(join(ROOT,'data',c.boundaryFile),JSON.stringify(display));
  console.log(c.name+'行政边界：'+features.length+'区');
  }
  if(c.contextProvider==='reuse')continue;
  const [w,s,e,n]=c.focusBounds||c.bounds,cache=join(ROOT,'data/site-cache/public-tiles');await mkdir(cache,{recursive:true});
  let context;
  if(c.contextProvider==='osm-vector'){
    context=(await vectorContext(c,cache)).features;
  }else if(c.contextProvider==='osm-pbf'){
    const file=join(cache,(c.contextCacheId||c.id)+'.osm.pbf');
    try{await readFile(file);}catch{const r=await fetch(c.contextPbfUrl,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw new Error('公共路网下载失败：'+r.status);await writeFile(file,new Uint8Array(await r.arrayBuffer()));}
    const result=spawnSync(process.env.TRAVEL_PYTHON||join(WORKSPACE_ROOT,'private/python/bin/python'),[join(ROOT,'scripts/extract-city-context.py'),file,join(ROOT,'data',c.contextFile),JSON.stringify(c.focusBounds||c.bounds)],{encoding:'utf8'});
    if(result.status!==0)throw new Error(result.stderr||result.error?.message||'公共路网提取失败');console.log(result.stdout.trim());continue;
  }else if(c.contextProvider==='osm'){
    const file=join(cache,c.id+'-osm.json');let osm;
    try{osm=JSON.parse(await readFile(file,'utf8'));}catch{
      const box=[s,w,n,e].join(','),query=`[out:json][timeout:90];(way[highway~"^(motorway|trunk|primary|secondary|tertiary)$"](${box});way[waterway~"^(river|canal)$"](${box});way[railway=rail](${box}););out geom;`;
      for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
        try{osm=await get(endpoint+'?data='+encodeURIComponent(query));break;}catch(err){console.log('公共路网源重试：'+err.message);}
      }
      if(!osm?.elements?.length)throw new Error(c.name+'公共路网未下载');await writeFile(file,JSON.stringify(osm));
    }
    context=osm.elements.filter(f=>f.type==='way'&&f.geometry?.length>1).map(f=>({type:'Feature',properties:{kind:f.tags.waterway?'water':f.tags.railway?'rail':'road',major:['motorway','trunk','primary'].includes(f.tags.highway)},geometry:{type:'LineString',coordinates:f.geometry.map(p=>[p.lon,p.lat])}}));
  }else{
    const z=16,size=2**z,tx=lon=>Math.floor((lon+180)/360*size),ty=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*size);
    const tasks=[],features=[],seen=new Set();
    for(let x=tx(w);x<=tx(e);x++)for(let y=ty(n);y<=ty(s);y++)for(const layer of ['experimental_rdcl','experimental_rvrcl'])tasks.push({x,y,layer});
    let at=0,done=0,failed=0;
    await Promise.all(Array.from({length:24},async()=>{while(at<tasks.length){const {x,y,layer}=tasks[at++],name=layer+'-'+x+'-'+y+'.json';let geo;
      try{geo=JSON.parse(await readFile(join(cache,name),'utf8'));}catch{
        try{const r=await fetch(`https://maps.gsi.go.jp/xyz/${layer}/${z}/${x}/${y}.geojson`,{signal:AbortSignal.timeout(20000)});if(r.status===404)geo={features:[]};else{if(!r.ok)throw new Error(String(r.status));geo=await r.json();}await writeFile(join(cache,name),JSON.stringify(geo));}catch{failed++;continue;}
      }
      for(const f of geo.features||[]){const p=f.properties,key=p.rID||p.rvID||JSON.stringify(f.geometry.coordinates);if(seen.has(key)||f.geometry.type!=='LineString')continue;
        const water=layer==='experimental_rvrcl',major=['国道','都道府県道','高速自動車国道'].includes(p.rdCtg);
        if(!water&&!major&&!['19.5m以上','13m以上19.5m未満'].includes(p.rnkWidth))continue;seen.add(key);
        features.push({type:'Feature',properties:{kind:water?'water':'road',major},geometry:f.geometry});
      }
      done++;if(done%500===0)console.log(c.name+'公共瓦片：'+done+'/'+tasks.length);
    }}));
    if(!features.length||failed>tasks.length*.1)throw new Error('公共地图瓦片不完整：'+failed+'个失败');context=features;
  }
  await writeFile(join(ROOT,'data',c.contextFile),JSON.stringify({type:'FeatureCollection',features:context}));
  console.log(c.name+'道路、河流、铁路：'+context.length+'条');
}
