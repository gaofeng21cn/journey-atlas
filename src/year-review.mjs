import {storyPageSvg} from './year-review-story.mjs';
import {travelTime} from './transport-time.mjs';
// Shared by the local CLI, offline annual-summary page and OPL entry.
export const reviewThemes=[{id:'life',name:'创造与行走'},{id:'travel',name:'旅行与移动'},{id:'creation',name:'创造与 AI'}];
export const reviewStyles=[{id:'paper',name:'奶油纸色',bg:'#f5f2e9',ink:'#173e35',muted:'#567265',accent:'#c37d5b',line:'#c6d0c4'},
  {id:'night',name:'午夜航线',bg:'#122238',ink:'#f2f1e9',muted:'#a9c3cf',accent:'#f1a269',line:'#345064'},
  {id:'blueprint',name:'蓝色护照',bg:'#eaf0f3',ink:'#183c60',muted:'#526d85',accent:'#ba654a',line:'#b5c8d6'}];
export const reviewFormats=[{id:'single',name:'单张总览'},{id:'story',name:'九张故事 · 朋友圈九宫格'}];
const defaultTitle=theme=>theme==='travel'?'在路上的这一年':theme==='creation'?'把想法变成作品':'在创造中前进，在旅途中发现';
const fmt=n=>Number(n).toLocaleString('en-US');
const present=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const metric=(value,unit,label)=>({value:String(value),unit,label});
const nonnegative=(v,name)=>{if(v!==undefined&&!present(v))throw new Error(`${name}须为非负数`);return v;};
const themeSections=(sections,theme)=>sections.filter(s=>theme==='life'||theme==='travel'&&s.id==='travel'||theme==='creation'&&s.id!=='travel');

function storyPages(model,{strict=true}={}){
  const candidates=new Map(),g=model.github||{},a=model.ai||{},travel=model.travelMetrics||{};
  const add=(id,title,details={})=>candidates.set(id,{id,kind:'story',title,...details});
  const sections=new Map(model.sections.map(s=>[s.id,s]));
  for(const s of model.sections)add(s.id,s.name,{section:s});
  if(sections.has('github')){
    if(g.longestStreakDays>0)add('rhythm','持续创造',{section:{metrics:[metric(fmt(g.longestStreakDays),'天','最长连续活跃')],notes:[]}});
    if(present(g.activeDays))add('active','活跃的日子',{lines:[`${fmt(g.activeDays)} 天有贡献记录`]});
    if(present(g.repositoriesWithCommits))add('repositories','创造的范围',{lines:[`${fmt(g.repositoriesWithCommits)} 个仓库有提交贡献`]});
    if(g.activeDays>0&&present(g.commitContributions))add('cadence','提交的密度',{lines:[`${fmt(g.commitContributions)} 次提交贡献，${fmt(g.activeDays)} 个活跃日，平均每个活跃日 ${(g.commitContributions/g.activeDays).toFixed(1)} 次`]});
  }
  if(sections.has('ai')&&present(a.cacheReadPercent))add('cache','Token 构成',{section:{metrics:[metric(a.cacheReadPercent,'%','缓存读取')],notes:[]}});
  if(model.projects.length&&model.theme!=='travel')add('projects','这一年的作品',{lines:model.projects.slice(0,4).flatMap(p=>[p.name,p.description].filter(Boolean))});
  if(model.theme!=='creation'){
    if(model.memory)add('memory',model.memory.title,{lines:model.memory.lines});
    if(model.farthest)add('farthest','走向远方',{section:{metrics:[metric(fmt(model.farthest.km),'公里',`离${model.base.name}的直线距离`)],notes:[model.farthest.name]}});
    if(present(travel.flightKm))add('distance','距离的尺度',{lines:[`${fmt(Math.round(travel.flightKm))} 飞行公里，相当于 ${(travel.flightKm/40075).toFixed(2)} 圈赤道`]});
    if(present(travel.flightHours)&&model.flightDurationKnown)add('duration','在空中的时间',{lines:[`飞行约 ${travel.flightHours} 小时，相当于约 ${(travel.flightHours/24).toFixed(1)} 天`]});
    if(model.flights.length&&model.flights.every(f=>/^\d{4}-(0[1-9]|1[0-2])(?:-|$)/.test(f.date))){
      const months=Array.from({length:12},()=>({actual:0,planned:0}));
      for(const flight of model.flights)months[Number(flight.date.slice(5,7))-1][flight.planned?'planned':'actual']+=Math.max(1,(flight.points?.length||2)-1);
      add('frequency','飞行的节奏',{months,lines:months.flatMap((m,i)=>m.actual+m.planned?[`${i+1} 月 ${m.actual+m.planned} 航段，其中 ${m.planned} 航段待飞`]:[])});
    }
    if(model.destinations.length)add('destinations','行程中的名字',{lines:model.destinations});
    if(present(travel.cities)&&present(travel.countries))add('visits','地面上的足迹',{lines:[`${travel.countries} 个国家与地区，${travel.cities} 个实际地面到访城市`]});
    if(model.flights.length&&model.flights.every(f=>f.cities?.[0])){
      const count=model.flights.filter(f=>f.cities[0]===model.base.name).length;
      add('departures','从这里出发',{count,lines:[`从${model.base.name}出发 ${count} 次`]});
    }
  }
  const order=model.theme==='travel'
    ?['travel','distance','frequency','duration','memory','destinations','farthest','visits','departures']
    :model.theme==='creation'
      ?['github','active','rhythm','projects','ai','cache','repositories','cadence']
      :['github','rhythm','projects','ai','cache','travel','memory','farthest','frequency','duration','distance','destinations','visits','departures','active','repositories','cadence'];
  const middle=order.filter(id=>candidates.has(id)).slice(0,7).map(id=>candidates.get(id));
  if(strict&&middle.length<7)throw new Error('固定九张故事需要更多年度资料：创造主题请补齐 GitHub 活跃、提交、仓库、连续活跃和 Tokscale 构成；旅行主题请补充行程日期、时长或年度片段。');
  return [{id:'cover',kind:'cover',title:model.title,subtitle:reviewThemes.find(t=>t.id===model.theme).name},...middle,
    {id:'closing',kind:'story',title:'这一年的坐标',lines:[model.title]}];
}
export function createYearReview(view,{theme='life',style='paper',format='single',profile={}}={}){
  if(!reviewThemes.some(t=>t.id===theme)||!reviewStyles.some(t=>t.id===style)||!reviewFormats.some(t=>t.id===format))throw new Error('请选择已有的年度主题、风格与形式');
  if(!Number.isInteger(view?.year))throw new Error('年度总结缺少有效年份');
  const g=profile.github,t=profile.tokscale,availableSections=[];
  for(const [key,v]of Object.entries(g||{}))if(['activeDays','commitContributions','repositoriesWithCommits','longestStreakDays'].includes(key)){
    nonnegative(v,`GitHub ${key}`);if(v!==undefined&&!Number.isInteger(v))throw new Error(`GitHub ${key} 须为非负整数`);
  }
  for(const key of ['totalTokens','cacheReadPercent'])nonnegative(t?.[key],`Tokscale ${key}`);
  if(present(t?.cacheReadPercent)&&t.cacheReadPercent>100)throw new Error('缓存读取占比须在0—100之间');
  if(g&&present(g.activeDays)&&present(g.commitContributions))availableSections.push({id:'github',name:'创造',eyebrow:'GITHUB',
    metrics:[metric(fmt(g.activeDays),'天','活跃天数'),metric(fmt(g.commitContributions),'次','提交贡献')],
    notes:[present(g.repositoriesWithCommits)?`${fmt(g.repositoriesWithCommits)} 个仓库有提交`:'',present(g.longestStreakDays)?`最长连续活跃 ${fmt(g.longestStreakDays)} 天`:''].filter(Boolean)});
  if(t&&present(t.totalTokens))availableSections.push({id:'ai',name:'协作',eyebrow:'TOKSCALE',
    metrics:[metric(t.totalTokens>=1e8?fmt(Math.round(t.totalTokens/1e8)):fmt(t.totalTokens),t.totalTokens>=1e8?'亿 Token':'Token','AI 协作')],
    notes:present(t.cacheReadPercent)?[`${t.cacheReadPercent}% 来自缓存读取`]:[]});
  availableSections.push({id:'travel',name:'行走',eyebrow:'TRAVEL',
    metrics:[metric(fmt(view.metrics.flightCount),'段','飞行航段'),metric(fmt(Math.round(view.metrics.flightKm)),'公里','飞行里程')],
    notes:(profile.destinations||view.cities?.map(c=>c.name)||[]).slice(0,5),
    mobility:{km:Math.round(view.metrics.totalKm),hours:view.metrics.flightHours,cities:view.metrics.cities,countries:view.metrics.countries},
    includesPlanned:Boolean(view.policy?.includePlanned)});
  const sections=themeSections(availableSections,theme);
  if(!sections.length)throw new Error('该主题暂无数据；请在年度配置中提供 GitHub 或 Tokscale 快照，或选择旅行主题');
  const memory=profile.memory||view.memory;
  const memoryLines=memory?.lines||(memory?[memory.label,memory.title,...(memory.body||[])].filter(Boolean):[]);
  const themeTitles=Object.fromEntries(reviewThemes.map(t=>[t.id,profile.title&&t.id===(profile.theme||'life')?profile.title:defaultTitle(t.id)]));
  const title=themeTitles[theme];
  const model={schema:'journey-atlas.year-review.v1',year:view.year,theme,style,format,title,themeTitles,name:profile.displayName||'',preview:view.asOf<`${view.year}-12-31`,
    asOf:view.asOf,dataThrough:view.dataThrough,sections,availableSections,memory:memoryLines.length?{title:memory.titleLabel||'移动的节奏',lines:memoryLines.slice(0,4),metrics:memory.metrics,range:memory.range,timeline:memory.timeline}:null,
    github:g?Object.fromEntries(['activeDays','commitContributions','repositoriesWithCommits','longestStreakDays'].filter(k=>present(g[k])).map(k=>[k,g[k]])):null,
    ai:t?{totalTokens:t.totalTokens,cacheReadPercent:t.cacheReadPercent}:null,
    base:view.base,farthest:view.farthest,travelMetrics:view.metrics,
    destinations:(profile.destinations||view.cities?.map(c=>c.name)||[]).slice(0,5),
    flightDurationKnown:(view.routes||[]).filter(r=>r.mode==='飞机'&&r.countDuration!==false).every(r=>travelTime(r).minutes!==null),
    flights:(view.routes||[]).filter(r=>r.mode==='飞机').map(r=>({id:r.id,date:r.startDate||r.date||'',points:r.points,cities:r.cities,planned:(view.plannedRouteIds||[]).includes(r.id)})),
    projects:(profile.projects||[]).map(p=>({name:String(p.name||''),description:String(p.description||'')})).filter(p=>p.name),
    sourceRefs:profile.sourceRefs||[],travelPolicy:view.policy,plannedRouteIds:view.plannedRouteIds||[]};
  const pages=storyPages(model,{strict:format==='story'});
  model.storyPages=pages;
  model.pages=format==='single'?[{id:'overview',kind:'overview',title}]:pages;
  return model;
}
export function selectYearReview(base,{theme=base.theme,style=base.style,format=base.format}={}){
  if(!reviewThemes.some(t=>t.id===theme)||!reviewStyles.some(s=>s.id===style)||!reviewFormats.some(f=>f.id===format))throw new Error('请选择已有的主题、风格和形式');
  const sections=themeSections(base.availableSections||base.sections,theme);
  if(!sections.length)throw new Error('这个年度尚无该主题数据，请先补充年度快照。');
  const title=base.themeTitles?.[theme]||defaultTitle(theme);
  const model={...base,theme,style,format,title,sections};
  const story=storyPages(model,{strict:format==='story'});
  return {...model,storyPages:story,pages:format==='single'?[{id:'overview',kind:'overview',title}]:story};
}
export const escapeReview=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
// Conservative line wrapping keeps labels readable in editable SVG and PNG.
function linesFor(text,maxUnits=22){
  const lines=[];let line='',width=0;
  for(const ch of String(text)){const n=/[\u0000-\u00ff]/u.test(ch)?0.55:1;if(ch==='\n'||width+n>maxUnits){lines.push(line);line='';width=0;if(ch==='\n')continue;}line+=ch;width+=n;}
  if(line)lines.push(line);return lines;
}
function text(x,y,value,{size=42,fill,weight=400,maxUnits=40,gap=1.4}={}){
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}"${fill?` fill="${fill}"`:''}>${linesFor(value,maxUnits).map((s,i)=>`<tspan x="${x}" dy="${i?size*gap:0}">${escapeReview(s)}</tspan>`).join('')}</text>`;
}
export function reviewPageSvg(model,pageIndex=0,{assets={}}={}){
  const page=model.pages[pageIndex];if(!page)throw new Error('年度总结页码不存在');
  const colors=reviewStyles.find(s=>s.id===model.style);if(!colors)throw new Error('年度总结风格不存在');
  if(page.kind!=='overview')return storyPageSvg(model,pageIndex,{colors,assets});
  const {bg,ink,muted,accent,line}=colors;
  const txt=(x,y,v,o={})=>text(x,y,v,{fill:ink,...o});
  const rule=y=>`<path d="M78 ${y}H1122" stroke="${line}"/>`;
  const stat=(m,x,y,size=100)=>txt(x,y,m.value,{size,weight:500,maxUnits:18})+txt(x+m.value.length*.57*size+12,y,m.unit,{size:38,maxUnits:15})+txt(x,y+70,m.label,{size:40,fill:muted,maxUnits:22});
  let body=txt(78,95,model.name?`${model.name.toUpperCase()} · YEAR IN REVIEW`:'YEAR IN REVIEW',{size:24,fill:muted,maxUnits:60})+
    txt(1122-(model.preview?152:80),95,model.preview?'年内预览':String(model.year),{size:30,fill:muted,maxUnits:12});
  if(page.kind==='overview'){
    body+=txt(78,292,String(model.year),{size:145,weight:500})+txt(640,198,model.title.replace('，','\n'),{size:42,weight:600,maxUnits:11})+rule(340);
    const height=970/model.sections.length;
    model.sections.forEach((s,i)=>{const y=400+i*height;body+=txt(78,y,s.name,{size:42,weight:600})+txt(205,y,s.eyebrow,{size:23,fill:muted});
      s.metrics.slice(0,2).forEach((m,j)=>{body+=stat(m,j?612:78,y+128,s.id==='travel'?94:104);});
      if(s.notes.length)body+=txt(78,y+257,s.notes.join(s.id==='travel'?' · ':'　'),{size:37,fill:muted,maxUnits:29});body+=rule(y+height-55);});
    if(model.memory&&model.theme!=='creation')body+=`<path d="M80 1385V1530" stroke="${accent}" stroke-width="4"/>`+txt(105,1404,'ON THE MOVE',{size:23,fill:accent})+model.memory.lines.slice(0,2).map((s,i)=>txt(105,1465+i*58,s,{size:42,maxUnits:23})).join('');
    else body+=txt(78,1490,'把这一年，留在自己的坐标里。',{size:40,fill:muted,maxUnits:25});
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-labelledby="review-title-${pageIndex}"><title id="review-title-${pageIndex}">${escapeReview(`${model.year} ${page.title}`)}</title><rect width="1200" height="1600" fill="${bg}"/><g font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif" fill="${ink}">${body}</g></svg>`;
}
export function reviewPageHtml(model,index=0,options={}){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeReview(model.year+' '+model.pages[index].title)}</title><style>html,body{margin:0}svg{display:block;max-width:100%;height:auto}body{background:${reviewStyles.find(s=>s.id===model.style).bg}}</style><body>${reviewPageSvg(model,index,options)}</body></html>`;}
