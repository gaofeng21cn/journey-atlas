import test from 'node:test';
import assert from 'node:assert/strict';
import {createYearReview,selectYearReview,reviewPageSvg,reviewPageHtml} from '../src/year-review.mjs';
const view={year:2026,asOf:'2026-10-01',dataThrough:'2026-09-30',base:{name:'示例基地'},metrics:{flightCount:12,flightKm:12345.6,totalKm:14000,flightHours:24,countries:2,cities:4},cities:[{name:'示例城市'}],policy:{includePlanned:true},plannedRouteIds:['PLANNED'],farthest:{name:'远方',km:5000}};
const profile={title:'在创造中前进，在旅途中发现',github:{activeDays:180,commitContributions:2400,repositoriesWithCommits:6,longestStreakDays:42},tokscale:{totalTokens:1200000000,cacheReadPercent:80},memory:{lines:['十月，12 天内 2 次出发、4 段飞行','12,345 公里 · 飞行约 24 小时']}};
test('同一年度快照生成单卡及最多九页故事，切换主题不混入未提供的数据',()=>{
 const before=structuredClone({view,profile});const base=createYearReview(view,{profile,format:'story'});
 assert.ok(base.pages.length>1&&base.pages.length<=9);assert.equal(base.sections[2].metrics[1].value,'12,346');
 const travel=selectYearReview(base,{theme:'travel',format:'single'});assert.equal(travel.pages.length,1);assert.deepEqual(travel.sections.map(s=>s.id),['travel']);
 const creation=selectYearReview(base,{theme:'creation',format:'story'});assert.ok(!creation.pages.some(p=>p.id==='memory'||p.id==='travel'));assert.deepEqual({view,profile},before);
 const bare=createYearReview(view,{theme:'travel'});assert.throws(()=>selectYearReview(bare,{theme:'creation'}),/主题数据/);
});
test('不接受未知主题、超范围比例或伪造缺失的GitHub数字；文本在SVG与HTML均转义',()=>{
 assert.throws(()=>createYearReview(view,{theme:'injected'}),/请选择/);
 assert.throws(()=>createYearReview(view,{profile:{tokscale:{totalTokens:4,cacheReadPercent:101}}}),/0—100/);
 assert.throws(()=>createYearReview(view,{profile:{github:{activeDays:-1,commitContributions:4}}}),/非负/);
 const m=createYearReview(view,{profile:{title:'<script>alert(1)</script>',destinations:['<foreignObject onload="x">']}});
 for(const html of [reviewPageSvg(m),reviewPageHtml(m)]){assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<foreignObject'));assert.ok(html.includes('&lt;script&gt;'));}
});
test('过长故事说明明确报错，不静默裁去事实',()=>{
 const model=createYearReview(view,{profile:{projects:[{name:'作品',description:'内容'.repeat(200)}]},format:'story'});
 const i=model.pages.findIndex(p=>p.id==='projects');assert.throws(()=>reviewPageSvg(model,i),/内容过长/);
});
test('主题切换同时更新封面，并与直接生成相同主题保持一致',()=>{
 const p={...profile,projects:[{name:'示例作品',description:'这一年完成的作品'}]};
 const base=createYearReview(view,{profile:p,format:'story'});
 for(const theme of ['travel','creation']){
  const switched=selectYearReview(base,{theme,format:'story'});
  const direct=createYearReview(view,{theme,profile:p,format:'story'});
  assert.equal(switched.title,direct.title);
  assert.deepEqual(switched.pages,direct.pages);
 }
 const creation=selectYearReview(base,{theme:'creation',format:'story'});
 assert.equal(creation.pages[0].subtitle,'创造与 AI');
 assert.ok(!creation.pages.some(p=>['travel','farthest','memory'].includes(p.id)));
 assert.ok(!createYearReview(view,{theme:'travel',profile:p,format:'story'}).pages.some(p=>p.id==='projects'));
});
