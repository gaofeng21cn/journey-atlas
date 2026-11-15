import {frameProject} from './map-frames.mjs';
import {circularBounds,unwrapLongitude} from './geographic-fit.mjs';
import {curvedPath} from './scope-model.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fmt=value=>Number(value).toLocaleString('en-US');
const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const bodyFont='PingFang SC, Hiragino Sans GB, sans-serif';
const sansFont='Review Sans, Arial, sans-serif';
const serifFont='Review Serif, Georgia, serif';
const units=value=>[...String(value)].reduce((n,c)=>n+(/[\u0000-\u00ff]/u.test(c)?/[ ,.]/.test(c)?.3:.64:1),0);

function wrap(value,width=20){
  const rows=[];let row='',used=0;
  for(const ch of String(value)){
    const w=units(ch);
    if(ch==='\n'||used+w>width){rows.push(row);row='';used=0;if(ch==='\n')continue;}
    row+=ch;used+=w;
  }
  if(row)rows.push(row);
  return rows;
}

function palette(style,id){
  const sets={
    paper:{light:['#f5f2e9','#173e35','#45665a','#aa5335'],dark:['#173e35','#f5f2e9','#c2d4c6','#f1a67d'],warm:['#a84d33','#fff7e8','#fff0df','#173e35'],soft:['#d6dfcf','#173e35','#45665a','#aa5335']},
    night:{light:['#eee9da','#122238','#455b68','#ac4d2c'],dark:['#122238','#f5f1e6','#afc7ce','#f0a174'],warm:['#de8b5b','#122238','#243848','#f9edcf'],soft:['#c4d9d4','#122238','#405d63','#a64326']},
    blueprint:{light:['#eaf0f3','#183c60','#4b667d','#ae4a2c'],dark:['#183c60','#edf3f4','#bdced8','#f1a377'],warm:['#a84d33','#fff5e9','#fff0df','#183c60'],soft:['#bdcfd8','#183c60','#3b596f','#a64326']},
  };
  const tone=id==='cover'&&style==='night'?'dark':['rhythm','cadence','destinations'].includes(id)?'warm':['github','travel','repositories','closing'].includes(id)?'dark':['farthest','cache','distance','active'].includes(id)?'soft':'light';
  const [bg,ink,muted,accent]=sets[style][tone];
  return {bg,ink,muted,accent,tone,number:style==='paper'?serifFont:sansFont,body:bodyFont,blueprint:style==='blueprint'};
}

function drawing(p){
  const t=(x,y,value,{size=48,color=p.ink,font=p.body,weight=500,anchor='start',width,opacity=1,spacing=0}={})=>{
    if(width)size=Math.min(size,width/Math.max(1,units(value)));
    return `<text x="${x}" y="${y}" fill="${color}" font-family="${font}" font-size="${size.toFixed(2)}" font-weight="${weight}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${spacing}">${esc(value)}</text>`;
  };
  const line=(d,color=p.ink,width=2,extra='')=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const circle=(x,y,r,color=p.ink,extra='')=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" ${extra}/>`;
  const rect=(x,y,w,h,color=p.ink,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" ${extra}/>`;
  const rows=(x,y,values,options={},gap=100)=>values.map((value,i)=>t(x,y+i*gap,value,options)).join('');
  return {t,line,circle,rect,rows};
}

function fontCss(fonts={}){
  return [
    fonts.sans?`@font-face{font-family:'Review Sans';src:url(data:font/ttf;base64,${fonts.sans}) format('truetype');font-weight:200 800;font-style:normal}`:'',
    fonts.serif?`@font-face{font-family:'Review Serif';src:url(data:font/ttf;base64,${fonts.serif}) format('truetype');font-weight:400;font-style:normal}`:'',
  ].join('');
}

function cover(model,p,d){
  const {t,line,circle}=d;
  const title=wrap(model.title.replace('，','\n'),11);
  let body=d.rows(600,260,title,{size:88,width:1030,weight:600,anchor:'middle'},122);
  // One unbroken line joins the three subject motifs. It is a cover device,
  // independent of the data graphics on the following pages.
  body+=line('M80 615 C340 410 1120 510 1080 850 S400 1250 180 1210',p.accent,5);
  body+=circle(80,615,9,p.accent)+circle(180,1210,9,p.accent);
  body+=t(60,1060,String(model.year),{size:424,font:p.number,weight:650,width:1090});
  const subjects=model.sections.map(s=>s.id==='github'?'创造':s.id==='ai'?'AI 协作':'行走');
  body+=t(80,1330,subjects.join('  /  '),{size:48,width:1040});
  body+=t(80,1410,'这一年，留下了自己的轨迹。',{size:42,color:p.muted,width:1040});
  return body;
}

function github(model,page,p,d){
  const {t,line}=d,g=model.github||{},metrics=page.section.metrics;
  let body=d.rows(80,236,['把想法','写进现实。'],{size:92,weight:600},116);
  // A pair of code brackets frames the contribution count, not a made-up
  // contribution calendar. There is no date-level GitHub evidence in this model.
  body+=line('M182 508 H112 V951 H182',p.accent,8)+line('M1018 508 H1088 V951 H1018',p.accent,8);
  body+=t(600,790,metrics[1].value,{size:250,font:p.number,weight:650,anchor:'middle',width:884});
  body+=t(600,894,'次提交贡献',{size:51,anchor:'middle'});
  body+=line('M80 1050 H1120',p.muted,1);
  body+=t(80,1240,metrics[0].value,{size:164,font:p.number,weight:600,width:450});
  body+=t(80,1320,'天活跃',{size:44,color:p.muted});
  if(known(g.repositoriesWithCommits)){
    body+=t(710,1240,fmt(g.repositoriesWithCommits),{size:164,font:p.number,weight:600,width:410});
    body+=t(710,1320,'个仓库有提交',{size:42,color:p.muted,width:410});
  }
  body+=t(80,1420,'GitHub',{size:42,font:sansFont,color:p.muted});
  return body;
}

function rhythm(model,page,p,d){
  const {t,line,circle}=d,days=model.github.longestStreakDays;
  let body=d.rows(600,240,['把持续','变成习惯。'],{size:92,weight:600,anchor:'middle'},116);
  body+=t(58,945,fmt(days),{size:416,font:p.number,weight:700,width:982});
  body+=t(1105,945,'天',{size:76,anchor:'end'});
  body+=t(80,1050,'最长连续活跃',{size:52});
  // The marks encode a consecutive run only. Their order is not a dated
  // calendar; years without day-level evidence never receive a heatmap.
  const columns=Math.max(1,Math.ceil(days/7)),step=1000/Math.max(1,columns-1);
  for(let i=0;i<days;i++){
    const row=Math.floor(i/columns),column=i%columns;
    body+=circle(92+column*step,1160+row*26,5.5,p.ink);
  }
  body+=line('M80 1430 H1120',p.ink,2);
  body+=t(80,1402,`${Math.floor(days/7)} 周${days%7?`又 ${days%7} 天`:''}`,{size:43});
  return body;
}

function ai(model,page,p,d){
  const {t,line}=d,metric=page.section.metrics[0];
  let body=t(72,400,metric.value,{size:246,font:p.number,weight:650,width:1035});
  body+=t(80,510,metric.unit,{size:65,font:metric.unit==='Token'?sansFont:p.body});
  body+=t(1120,510,'Tokscale',{size:39,font:sansFont,anchor:'end',color:p.muted});
  for(let i=0;i<10;i++)body+=line(`M-60 ${670+i*30} C230 ${500+i*39}, 710 ${970+i*25}, 1260 ${740+i*38}`,i===4?p.accent:p.ink,i===4?6:1.8,`opacity="${i===4?1:.3}" aria-hidden="true"`);
  body+=t(78,1260,'与 AI 一起',{size:104,weight:600,width:1040});
  body+=t(78,1400,'让想法，继续向前。',{size:65,width:1040});
  return body;
}

function cache(model,page,p,d){
  const {t,circle}=d,percent=model.ai.cacheReadPercent,x=600,y=875,r=345,circumference=2*Math.PI*r;
  let body=t(80,240,'Token 的另一面',{size:86,weight:600,width:1040});
  body+=t(80,340,'上下文，也在一次次被重新调用。',{size:44,color:p.muted,width:1040});
  body+=circle(x,y,r,'none',`stroke="${p.accent}" stroke-width="85"`);
  body+=circle(x,y,r,'none',`stroke="${p.ink}" stroke-width="85" stroke-dasharray="${circumference*percent/100} ${circumference}" transform="rotate(-90 ${x} ${y})"`);
  body+=t(x,y+12,`${percent}%`,{size:150,font:sansFont,weight:650,anchor:'middle',width:550});
  body+=t(x,y+98,'缓存读取',{size:53,anchor:'middle'});
  body+=circle(90,1360,8,p.ink)+t(116,1375,`${percent}% 缓存读取`,{size:40,width:510});
  body+=circle(720,1360,8,p.accent)+t(746,1375,`${Number((100-percent).toFixed(1))}% 其他 Token`,{size:38,width:380});
  return body;
}

function active(model,page,p,d){
  const {t,line}=d;
  let body=d.rows(80,310,['有贡献','记录的','日子。'],{size:100,weight:600},130);
  body+=line('M510 230 V1260',p.accent,3);
  body+=t(1120,1010,fmt(model.github.activeDays),{size:340,font:p.number,weight:650,anchor:'end',width:565});
  body+=t(1110,1130,'天活跃',{size:65,anchor:'end'});
  body+=t(80,1420,'GitHub',{size:43,font:sansFont,color:p.muted});
  return body;
}

function repositories(model,page,p,d){
  const {t,rect}=d,count=model.github.repositoriesWithCommits;
  let body=t(80,240,'创造，向不同方向生长。',{size:76,weight:600,width:1040});
  body+=t(600,635,fmt(count),{size:330,font:p.number,weight:650,anchor:'middle',width:1040});
  body+=t(600,750,'个仓库有提交贡献',{size:53,anchor:'middle',width:1040});
  const columns=Math.max(1,Math.ceil(Math.sqrt(Math.min(count,120))*1.6)),step=Math.min(66,1000/columns);
  for(let i=0;i<Math.min(count,120);i++)body+=rect(90+i%columns*step,920+Math.floor(i/columns)*63,step-15,45,i%3===0?p.accent:p.ink);
  return body;
}

function cadence(model,page,p,d){
  const {t,line}=d,g=model.github,average=(g.commitContributions/g.activeDays).toFixed(1);
  let body=t(80,235,'提交的密度',{size:86,weight:600});
  body+=t(600,545,fmt(g.commitContributions),{size:162,font:p.number,weight:650,anchor:'middle',width:900});
  body+=line('M180 640 H1020',p.ink,3);
  body+=t(600,855,fmt(g.activeDays),{size:162,font:p.number,weight:650,anchor:'middle',width:900});
  body+=t(600,940,'个活跃日',{size:44,anchor:'middle'});
  body+=t(80,1250,average,{size:232,font:p.number,weight:650,width:840});
  body+=t(80,1360,'次提交贡献／活跃日',{size:52});
  body+=t(80,1440,'按活跃日平均',{size:40,color:p.muted});
  return body;
}

function distance(model,page,p,d){
  const {t,circle}=d,km=model.travelMetrics.flightKm,turns=km/40075;
  let body=t(80,240,'把距离，放回地球的尺度。',{size:75,weight:600,width:1040});
  body+=t(80,430,turns.toFixed(2),{size:226,font:p.number,weight:650,width:875});
  body+=t(80,535,'圈赤道',{size:65});
  const full=Math.floor(turns),step=Math.min(43,160/Math.max(1,full));
  for(let i=0;i<=full;i++){
    const r=200+i*step,c=2*Math.PI*r,part=i<full?1:Math.min(1,turns-full);
    body+=circle(600,975,r,'none',`stroke="${p.ink}" stroke-opacity=".16" stroke-width="8"`);
    if(part>0)body+=circle(600,975,r,'none',`stroke="${i===full?p.accent:p.ink}" stroke-width="8" stroke-dasharray="${c*part} ${c}" transform="rotate(-90 600 975)"`);
  }
  body+=t(600,1000,fmt(Math.round(km)),{size:115,font:p.number,weight:650,anchor:'middle',width:450});
  body+=t(600,1070,'飞行公里',{size:41,anchor:'middle'});
  body+=t(80,1450,'飞行里程相当于绕赤道的圈数',{size:43,width:1040});
  return body;
}

function duration(model,page,p,d){
  const {t,rect,line}=d,hours=model.travelMetrics.flightHours,days=hours/24;
  let body=t(80,240,'在空中的时间',{size:86,weight:600});
  body+=t(80,610,fmt(hours),{size:310,font:p.number,weight:650,width:880});
  body+=t(1120,610,'小时',{size:65,anchor:'end'});
  body+=t(80,735,'飞行时长约数',{size:47,color:p.muted});
  const cells=Math.ceil(days),columns=Math.max(1,Math.ceil(Math.sqrt(cells*2))),rows=Math.max(1,Math.ceil(cells/columns));
  const cellW=Math.min(140,1040/columns-18),cellH=Math.min(58,340/rows-15);
  for(let i=0;i<cells;i++){
    const x=80+i%columns*(1040/columns),y=880+Math.floor(i/columns)*(340/rows);
    body+=rect(x,y,cellW,cellH,p.ink,`opacity=".15"`);
    body+=rect(x,y,cellW*Math.min(1,Math.max(0,days-i)),cellH,p.ink);
  }
  body+=line('M80 1330 H1120',p.muted,1);
  body+=t(80,1445,`相当于约 ${days.toFixed(1)} 天`,{size:60,width:1040});
  return body;
}

function frequency(model,page,p,d){
  const {t,rect}=d,months=page.months;
  const totals=months.map(m=>m.actual+m.planned),max=Math.max(1,...totals),peak=totals.indexOf(max);
  let body=t(80,240,'飞行，也有自己的节奏。',{size:77,weight:600,width:1040});
  body+=t(80,475,`${peak+1} 月`,{size:150,font:p.number,weight:650});
  body+=t(1120,475,`${max} 段`,{size:145,font:p.number,weight:650,anchor:'end'});
  for(let i=0;i<12;i++){
    const x=86+i*87,scale=495/max;
    body+=rect(x,1180-months[i].actual*scale,52,months[i].actual*scale,p.ink);
    body+=rect(x,1180-totals[i]*scale,52,months[i].planned*scale,p.accent);
    body+=t(x+26,1250,String(i+1),{size:35,font:sansFont,anchor:'middle'});
    if(totals[i])body+=t(x+26,1155-totals[i]*scale,String(totals[i]),{size:34,font:sansFont,anchor:'middle'});
  }
  body+=t(80,1380,'按航段出发月份',{size:43});
  body+=rect(80,1422,30,30,p.ink)+t(130,1450,'记录航段',{size:38,color:p.ink});
  if(months.some(m=>m.planned))body+=rect(750,1422,30,30,p.accent)+t(800,1450,'待飞行程',{size:38,color:p.ink});
  return body;
}

function destinations(model,page,p,d){
  const {t,line}=d,names=model.destinations;
  let body=t(80,240,'行程中的名字',{size:86,weight:600});
  names.forEach((name,i)=>{
    const y=480+i*195,x=i%2?1120:80;
    body+=t(x,y,name,{size:104,anchor:i%2?'end':'start',width:1040,weight:600});
    if(i<names.length-1)body+=line(`M${i%2?1030:160} ${y+50} L${i%2?160:1030} ${y+130}`,p.muted,1.5);
  });
  return body;
}

function visits(model,page,p,d){
  let body=d.t(80,240,'地面上的足迹',{size:86,weight:600});
  body+=d.t(80,650,fmt(model.travelMetrics.countries),{size:260,font:p.number,weight:650,width:950});
  body+=d.t(80,755,'个国家与地区',{size:57});
  body+=d.t(1120,1180,fmt(model.travelMetrics.cities),{size:260,font:p.number,weight:650,anchor:'end',width:950});
  body+=d.t(1120,1290,'个城市',{size:57,anchor:'end'});
  return body;
}

function departures(model,page,p,d){
  const n=page.count;
  return d.t(80,260,`从${model.base.name}出发`,{size:90,weight:600,width:1040})+d.t(600,950,fmt(n),{size:430,font:p.number,weight:650,anchor:'middle',width:1000})+d.t(600,1090,'次出发',{size:65,anchor:'middle'});
}

function closing(model,page,p,d){
  const {t,line,circle}=d;
  const title=model.theme==='creation'?['继续创造，','让想法继续生长。']:model.theme==='travel'?['继续出发，','把世界连在一起。']:['继续创造，','也继续出发。'];
  let body=d.rows(80,290,title,{size:88,weight:600,width:1040},130);
  const points=model.sections.map((section,i)=>({x:model.sections.length===1?600:model.sections.length===2?300+i*600:210+i*390,y:800+(i%2?220:0),section}));
  if(points.length>1)body+=line(`M${points.map(v=>`${v.x} ${v.y}`).join(' L')}`,p.accent,3);
  points.forEach(({x,y,section})=>{
    body+=circle(x,y,94,p.bg,`stroke="${p.ink}" stroke-width="3"`);
    body+=t(x,y+18,section.name,{size:49,anchor:'middle'});
    const m=section.id==='github'?section.metrics[0]:section.id==='travel'?section.metrics[1]:section.metrics[0];
    body+=t(x,y+181,`${m.value} ${m.unit}`,{size:42,font:section.id==='ai'?p.body:sansFont,anchor:'middle',width:350});
  });
  body+=t(80,1395,String(model.year),{size:92,font:p.number,weight:600});
  body+=t(1120,1395,'我的年度坐标',{size:49,anchor:'end'});
  return body;
}

const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;

function networkMap(flights,world,p,{x=0,y=540,w=1200,h=650,id='map',round=false}={}){
  const positions=flights.flatMap(r=>(r.points||[]).filter(validPoint));
  if(!positions.length)return '';
  const b=circularBounds(positions.map(([lat,lon])=>[lon,lat]));
  const padLon=Math.max(7,(b[2]-b[0])*.1),padLat=Math.max(6,(b[3]-b[1])*.22);
  const bounds=[b[0]-padLon,Math.max(-78,b[1]-padLat),b[2]+padLon,Math.min(78,b[3]+padLat)];
  const center=(bounds[0]+bounds[2])/2;
  const rawProject=frameProject({bounds,extent:[x,y,w,h]});
  const project=([lat,lon])=>rawProject([lat,unwrapLongitude(lon,center)]);
  const clip=round?`<circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2}"/>`:`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  let land='';
  for(const feature of world?.features||[]){
    const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[];
    for(const polygon of polygons)for(const shift of [-360,0,360]){
      const path=polygon.map(ring=>{
        let previous=center;
        return ring.map(([lon,lat],i)=>{
          const normalized=unwrapLongitude(lon,previous);previous=normalized;
          // Projection receives a longitude already unwrapped for this ring.
          const [px,py]=rawProject([lat,normalized+shift]);
          return `${i?'L':'M'}${px.toFixed(1)},${py.toFixed(1)}`;
        }).join('')+'Z';
      }).join('');
      land+=`<path d="${path}" fill="${p.ink}" fill-opacity=".1" stroke="${p.ink}" stroke-opacity=".2" stroke-width="1.2" fill-rule="evenodd"/>`;
    }
  }
  const nodes=new Map(),routes=[];
  for(const flight of flights)for(let i=1;i<(flight.points||[]).length;i++){
    const a=flight.points[i-1],b=flight.points[i];if(!validPoint(a)||!validPoint(b))continue;
    const from=project(a),to=project(b),path=curvedPath(from,to,'飞机');
    if(!path)continue;
    routes.push(`<path d="${path}" fill="none" stroke="${flight.planned?p.accent:p.ink}" stroke-width="${p.blueprint?2.2:2.8}" opacity=".74" ${flight.planned?'stroke-dasharray="9 9"':''} data-route="${esc(flight.id)}"/>`);
    for(const point of [from,to])nodes.set(point.map(v=>v.toFixed(2)).join(','),point);
  }
  const marks=[...nodes.values()].map(([px,py])=>`<circle cx="${px}" cy="${py}" r="5.2" fill="${p.accent}" stroke="${p.bg}" stroke-width="1.8"/>`).join('');
  return `<defs><clipPath id="${id}">${clip}</clipPath></defs><g clip-path="url(#${id})" aria-hidden="true">${land}${routes.join('')}${marks}</g>`;
}

function travel(model,page,p,d,assets,id){
  const {t,line}=d,section=page.section;
  let body=d.rows(80,242,['一次次','出发'],{size:108,weight:600},132);
  body+=t(1120,435,section.metrics[0].value,{size:304,font:p.number,weight:650,anchor:'end',width:620});
  body+=t(1120,520,'飞行航段',{size:46,anchor:'end'});
  body+=networkMap(model.flights||[],assets.world,p,{x:20,y:590,w:1160,h:555,id:id+'-routes'});
  body+=line('M80 1190 H1120',p.muted,1);
  body+=t(80,1375,section.metrics[1].value,{size:174,font:p.number,weight:650,width:885});
  body+=t(1120,1368,'公里',{size:56,anchor:'end'});
  body+=t(80,1450,'飞行里程',{size:44,color:p.muted});
  return body;
}

function mobility(model,page,p,d){
  const {t,line,circle}=d,memory=model.memory,m=memory.metrics;
  if(!m||!known(m.departures)||!known(m.count)||!known(m.km))return letter(page,p,d);
  const title=memory.range?.from?`${Number(memory.range.from.slice(5,7))} 月，移动的密度`:page.title;
  let body=t(80,230,title,{size:76,weight:600,width:1040});
  body+=d.rows(80,329,wrap(memory.lines[0],24),{size:42,color:p.muted,width:1040},61);
  const marks=memory.timeline||[];
  const n=Math.max(1,marks.length),positions=marks.map((r,i)=>[r.departure?170:330,500+i*490/Math.max(1,n-1)]);
  if(positions.length){
    const path=positions.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join(' ');
    body+=line(path,p.accent,6);
    positions.forEach(([x,y],i)=>{body+=circle(x,y,marks[i].departure?15:10,marks[i].departure?p.accent:p.ink);});
  }
  body+=t(650,650,fmt(m.departures),{size:218,font:p.number,weight:650});
  body+=t(650,725,'次出发',{size:46,color:p.muted});
  body+=t(650,990,fmt(m.count),{size:218,font:p.number,weight:650});
  body+=t(650,1060,'段飞行',{size:46,color:p.muted});
  body+=line('M80 1140 H1120',p.ink,2);
  body+=t(80,1340,fmt(m.km),{size:175,font:p.number,weight:650,width:795});
  body+=t(1120,1332,'公里',{size:54,anchor:'end'});
  if(known(m.hours))body+=t(80,1440,`飞行约 ${fmt(m.hours)} 小时`,{size:52});
  return body;
}

function farthest(model,page,p,d,assets,id){
  const {t,line}=d,place=model.farthest||{},base=model.base||{};
  let body=t(600,318,place.name||page.section.notes[0],{size:166,weight:600,width:1040,anchor:'middle'});
  if(place.country)body+=t(600,416,place.country,{size:48,anchor:'middle',color:p.muted});
  body+=t(600,510,'这一年，最远的到访地',{size:46,anchor:'middle'});
  const points=[[base.lat,base.lon],[place.lat,place.lon]];
  if(points.every(validPoint))body+=networkMap([{id:'base-to-farthest-distance',points}],assets.world,p,{x:20,y:600,w:640,h:760,id:id+'-distance',round:true});
  body+=line('M670 726 H1120',p.accent,3);
  body+=t(670,815,`离${base.name||place.from||'基地'}`,{size:54,width:450});
  body+=t(670,888,'直线距离',{size:54});
  body+=t(670,1104,page.section.metrics[0].value,{size:164,font:p.number,weight:650,width:450});
  body+=t(670,1180,'公里',{size:52});
  body+=t(80,1430,'把这一年，留在自己的坐标里。',{size:46,width:1040});
  return body;
}

function projects(model,page,p,d){
  let body=d.t(80,240,'这一年的作品',{size:86,weight:600});
  const items=model.projects.slice(0,4),gap=1000/Math.max(1,items.length);
  items.forEach((project,i)=>{
    const y=418+i*gap,rows=wrap(project.description,23);
    if(rows.length>Math.floor((gap-110)/53))throw new Error('这一页内容过长；请缩短年度片段或作品说明');
    body+=d.line(`M80 ${y-44} H1120`,p.muted,1);
    body+=d.t(80,y+32,project.name,{size:items.length>2?65:83,weight:600,width:1040});
    body+=d.rows(80,y+112,rows,{size:40,color:p.muted,width:1040},53);
  });
  return body;
}

function letter(page,p,d){
  const rows=page.lines.flatMap(value=>wrap(value,19));
  if(rows.length>12)throw new Error('这一页内容过长；请缩短年度片段或作品说明');
  let body=d.t(80,250,page.title,{size:82,weight:600,width:1040});
  body+=d.line('M80 382 H450',p.accent,3);
  body+=d.rows(80,560,rows,{size:rows.length>8?44:56,width:1040},Math.min(152,850/Math.max(1,rows.length-1)));
  return body;
}

export function storyPageSvg(model,index,{colors,assets={}}){
  const page=model.pages[index],p=palette(model.style,page.id),d=drawing(p),id=`review-${model.year}-${model.theme}-${model.style}-${index}`;
  let body;
  switch(page.id){
    case 'cover':body=cover(model,p,d);break;
    case 'github':body=github(model,page,p,d);break;
    case 'rhythm':body=rhythm(model,page,p,d);break;
    case 'ai':body=ai(model,page,p,d);break;
    case 'cache':body=cache(model,page,p,d);break;
    case 'active':body=active(model,page,p,d);break;
    case 'repositories':body=repositories(model,page,p,d);break;
    case 'cadence':body=cadence(model,page,p,d);break;
    case 'distance':body=distance(model,page,p,d);break;
    case 'duration':body=duration(model,page,p,d);break;
    case 'frequency':body=frequency(model,page,p,d);break;
    case 'destinations':body=destinations(model,page,p,d);break;
    case 'visits':body=visits(model,page,p,d);break;
    case 'departures':body=departures(model,page,p,d);break;
    case 'travel':body=travel(model,page,p,d,assets,id);break;
    case 'memory':body=mobility(model,page,p,d);break;
    case 'farthest':body=farthest(model,page,p,d,assets,id);break;
    case 'projects':body=projects(model,page,p,d);break;
    case 'closing':body=closing(model,page,p,d);break;
    default:body=letter(page,p,d);
  }
  const name=model.name||'YEAR IN REVIEW';
  const header=d.t(80,94,name,{size:26,font:sansFont,color:p.muted,width:760})+d.t(1120,94,String(model.year),{size:31,font:sansFont,anchor:'end',color:p.muted});
  const footer=d.t(80,1543,model.preview?'年内故事':'年度故事',{size:28,color:p.muted})+d.t(1120,1543,`${index+1} / ${model.pages.length}`,{size:29,font:sansFont,anchor:'end',color:p.muted});
  const details=page.section?page.section.metrics.map(m=>`${m.value} ${m.unit} ${m.label}`).concat(page.section.notes||[]):page.lines||[model.title];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-labelledby="${id}-title" aria-describedby="${id}-description" data-story-layout="${page.id}"><title id="${id}-title">${esc(`${model.year} ${page.title}`)}</title><desc id="${id}-description">${esc(details.join('；'))}</desc><style>${fontCss(assets.fonts)}</style><rect width="1200" height="1600" fill="${p.bg}"/>${header}${body}${footer}</svg>`;
}
