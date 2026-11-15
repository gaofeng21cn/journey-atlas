// Shared by the local CLI, offline annual-summary page and OPL entry.
export const reviewThemes=[{id:'life',name:'创造与行走'},{id:'travel',name:'旅行与移动'},{id:'creation',name:'创造与 AI'}];
export const reviewStyles=[{id:'paper',name:'奶油纸色',bg:'#f5f2e9',ink:'#173e35',muted:'#567265',accent:'#c37d5b',line:'#c6d0c4'},
  {id:'night',name:'午夜航线',bg:'#122238',ink:'#f2f1e9',muted:'#a9c3cf',accent:'#f1a269',line:'#345064'},
  {id:'blueprint',name:'蓝色护照',bg:'#eaf0f3',ink:'#183c60',muted:'#526d85',accent:'#ba654a',line:'#b5c8d6'}];
export const reviewFormats=[{id:'single',name:'单张总览'},{id:'story',name:'多张故事 · 最多九张'}];
const defaultTitle=theme=>theme==='travel'?'在路上的这一年':theme==='creation'?'把想法变成作品':'在创造中前进，在旅途中发现';
const fmt=n=>Number(n).toLocaleString('en-US');
const present=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const metric=(value,unit,label)=>({value:String(value),unit,label});
const nonnegative=(v,name)=>{if(v!==undefined&&!present(v))throw new Error(`${name}须为非负数`);return v;};
export function createYearReview(view,{theme='life',style='paper',format='single',profile={}}={}){
  if(!reviewThemes.some(t=>t.id===theme)||!reviewStyles.some(t=>t.id===style)||!reviewFormats.some(t=>t.id===format))throw new Error('请选择已有的年度主题、风格与形式');
  if(!Number.isInteger(view?.year))throw new Error('年度总结缺少有效年份');
  const g=profile.github,t=profile.tokscale,sections=[];
  for(const [key,v]of Object.entries(g||{}))if(['activeDays','commitContributions','repositoriesWithCommits','longestStreakDays'].includes(key))nonnegative(v,`GitHub ${key}`);
  for(const key of ['totalTokens','cacheReadPercent'])nonnegative(t?.[key],`Tokscale ${key}`);
  if(present(t?.cacheReadPercent)&&t.cacheReadPercent>100)throw new Error('缓存读取占比须在0—100之间');
  if(theme!=='travel'&&g&&present(g.activeDays)&&present(g.commitContributions))sections.push({id:'github',name:'创造',eyebrow:'GITHUB',
    metrics:[metric(fmt(g.activeDays),'天','活跃天数'),metric(fmt(g.commitContributions),'次','提交贡献')],
    notes:[present(g.repositoriesWithCommits)?`${fmt(g.repositoriesWithCommits)} 个仓库有提交`:'',present(g.longestStreakDays)?`最长连续活跃 ${fmt(g.longestStreakDays)} 天`:''].filter(Boolean)});
  if(theme!=='travel'&&t&&present(t.totalTokens))sections.push({id:'ai',name:'协作',eyebrow:'TOKSCALE',
    metrics:[metric(t.totalTokens>=1e8?fmt(Math.round(t.totalTokens/1e8)):fmt(t.totalTokens),t.totalTokens>=1e8?'亿 Token':'Token','AI 协作')],
    notes:present(t.cacheReadPercent)?[`${t.cacheReadPercent}% 来自缓存读取`]:[]});
  if(theme!=='creation')sections.push({id:'travel',name:'行走',eyebrow:'TRAVEL',
    metrics:[metric(fmt(view.metrics.flightCount),'段','飞行航段'),metric(fmt(Math.round(view.metrics.flightKm)),'公里','飞行里程')],
    notes:(profile.destinations||view.cities?.map(c=>c.name)||[]).slice(0,5),
    mobility:{km:Math.round(view.metrics.totalKm),hours:view.metrics.flightHours,cities:view.metrics.cities,countries:view.metrics.countries},
    includesPlanned:Boolean(view.policy?.includePlanned)});
  if(!sections.length)throw new Error('该主题暂无数据；请在年度配置中提供 GitHub 或 Tokscale 快照，或选择旅行主题');
  const memory=profile.memory||view.memory;
  const memoryLines=memory?.lines||(memory?[memory.label,memory.title,...(memory.body||[])].filter(Boolean):[]);
  const themeTitles=Object.fromEntries(reviewThemes.map(t=>[t.id,profile.title&&t.id===(profile.theme||'life')?profile.title:defaultTitle(t.id)]));
  const title=themeTitles[theme];
  const model={schema:'journey-atlas.year-review.v1',year:view.year,theme,style,format,title,themeTitles,name:profile.displayName||'',preview:view.asOf<`${view.year}-12-31`,
    asOf:view.asOf,dataThrough:view.dataThrough,sections,memory:memoryLines.length?{title:memory.titleLabel||'移动的节奏',lines:memoryLines.slice(0,4)}:null,
    projects:(profile.projects||[]).map(p=>({name:String(p.name||''),description:String(p.description||'')})).filter(p=>p.name),
    sourceRefs:profile.sourceRefs||[],travelPolicy:view.policy,plannedRouteIds:view.plannedRouteIds||[]};
  const pages=[{id:'cover',kind:'cover',title,subtitle:reviewThemes.find(t=>t.id===theme).name}];
  for(const s of sections){
    pages.push({id:s.id,kind:'metrics',title:s.name,section:s});
    if(s.id==='github'&&present(g.longestStreakDays)&&g.longestStreakDays>0)pages.push({id:'rhythm',kind:'metrics',title:'持续创造',section:{metrics:[metric(fmt(g.longestStreakDays),'天','最长连续活跃')],notes:['让想法，在一次次提交中向前。']}});
  }
  if(model.projects.length&&theme!=='travel')pages.push({id:'projects',kind:'text',title:'这一年的作品',lines:model.projects.slice(0,4).flatMap(p=>[p.name,p.description].filter(Boolean))});
  if(model.memory&&theme!=='creation')pages.push({id:'memory',kind:'text',title:model.memory.title,lines:model.memory.lines});
  if(view.farthest&&theme!=='creation')pages.push({id:'farthest',kind:'metrics',title:'走向远方',section:{metrics:[metric(fmt(view.farthest.km),'公里',`离${view.base.name}的直线距离`)],notes:[view.farthest.name]}});
  if(pages.length>9)throw new Error('多卡片最多九页；请减少可选主题内容');
  model.storyPages=pages;
  model.pages=format==='single'?[{id:'overview',kind:'overview',title}]:pages;
  return model;
}
export function selectYearReview(base,{theme=base.theme,style=base.style,format=base.format}={}){
  if(!reviewThemes.some(t=>t.id===theme)||!reviewStyles.some(s=>s.id===style)||!reviewFormats.some(f=>f.id===format))throw new Error('请选择已有的主题、风格和形式');
  const sections=base.sections.filter(s=>theme==='life'||theme==='travel'&&s.id==='travel'||theme==='creation'&&s.id!=='travel');
  if(!sections.length)throw new Error('这个年度尚无该主题数据，请先补充年度快照。');
  const ids=new Set(sections.map(s=>s.id));
  const title=base.themeTitles?.[theme]||defaultTitle(theme);
  const story=base.storyPages.filter(p=>p.kind==='cover'||ids.has(p.id)||p.id==='rhythm'&&ids.has('github')||p.id==='projects'&&theme!=='travel'||p.id==='memory'&&theme!=='creation'||p.id==='farthest'&&theme!=='creation')
    .map(p=>p.kind==='cover'?{...p,title,subtitle:reviewThemes.find(t=>t.id===theme).name}:p);
  return {...base,theme,style,format,title,sections,pages:format==='single'?[{id:'overview',kind:'overview',title}]:story};
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
export function reviewPageSvg(model,pageIndex=0){
  const page=model.pages[pageIndex];if(!page)throw new Error('年度总结页码不存在');
  const colors=reviewStyles.find(s=>s.id===model.style);if(!colors)throw new Error('年度总结风格不存在');
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
  }else{
    body+=txt(78,280,String(model.year),{size:140,weight:500})+rule(345)+txt(78,450,page.title,{size:58,weight:600,maxUnits:18});
    if(page.kind==='cover')body+=txt(78,710,model.title.replace('，','\n'),{size:78,weight:500,maxUnits:13,gap:1.55})+txt(78,1220,page.subtitle,{size:42,fill:muted,maxUnits:20});
    if(page.kind==='metrics'){
      page.section.metrics.forEach((m,i)=>{body+=stat(m,78,710+i*300,142);});
      if(page.section.notes.length)body+=txt(78,1345,page.section.notes.join(' · '),{size:42,fill:muted,maxUnits:24});
    }
    if(page.kind==='text'){
      const rows=page.lines.flatMap(s=>linesFor(s,23));if(rows.length>12)throw new Error('这一页内容过长；请缩短年度片段或作品说明');
      rows.forEach((s,i)=>{body+=txt(78,620+i*Math.min(165,750/Math.max(1,rows.length-1)),s,{size:rows.length>7?42:49,fill:i===0?ink:muted,maxUnits:24});});
    }
    body+=rule(1480)+txt(78,1535,reviewThemes.find(t=>t.id===model.theme).name,{size:27,fill:muted})+txt(1000,1535,`${pageIndex+1} / ${model.pages.length}`,{size:27,fill:accent});
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-labelledby="review-title-${pageIndex}"><title id="review-title-${pageIndex}">${escapeReview(`${model.year} ${page.title}`)}</title><rect width="1200" height="1600" fill="${bg}"/><g font-family="PingFang SC, Hiragino Sans GB, Arial, sans-serif" fill="${ink}">${body}</g></svg>`;
}
export function reviewPageHtml(model,index=0){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeReview(model.year+' 年度总结')}</title><style>html,body{margin:0}svg{display:block;max-width:100%;height:auto}body{background:${reviewStyles.find(s=>s.id===model.style).bg}}</style><body>${reviewPageSvg(model,index)}</body></html>`;}
