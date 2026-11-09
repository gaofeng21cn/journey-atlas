import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopeEngine} from '../src/scope-model.mjs';
import {mapMarkup} from '../src/site-map.mjs';
import {isRecordedMovement} from '../src/route-semantics.mjs';

function fixture(city=false){
  const a={id:'A',name:'甲地点',country:'甲国',unitId:'U',lat:30,lon:110,active:true,visited:true},b={...a,id:'B',name:'乙地点',lat:31,lon:111},c={...a,id:'C',name:'只有结构的国内点',lat:30.5,lon:110.5,active:false,visited:false},outside={...a,id:'X',name:'不应显示的海外节点',country:'乙国',lat:40,lon:120,active:false,visited:false},candidate={...a,id:'Q',name:'只有候选的点',lat:30.8,lon:110.8,active:false,visited:false};
  const routes=[{id:'LINK-OVERSEAS',mode:'交通方式待定',structuralLink:true,countDistance:false,countDuration:false,nodes:[a,outside]},
    {id:'LINK-SAME',mode:'交通方式待定',structuralLink:true,countDistance:false,countDuration:false,nodes:[a,b]},
    {id:'REAL',mode:'铁路',km:100,minutes:0,date:'2020',nodes:[a,b]},
    {id:'LINK-INTERNAL',mode:'交通方式待定',structuralLink:true,countDistance:false,countDuration:false,nodes:[b,c]},
    {id:'CANDIDATE',mode:'飞机',candidate:true,countDistance:false,countDuration:false,nodes:[candidate,outside]}];
  const data={meta:{totalKm:100,flightMinutes:0,nodes:5},places:[a,b,c,outside,candidate],geometries:{},contexts:{},dots:[],routes,
    scopes:[{id:'world',name:'全球',english:'WORLD',level:'world',countries:['甲国','乙国'],units:[],bounds:[-180,-58,180,84]},
      {id:'a',name:'甲国',english:'A',level:'country',parent:'world',countries:['甲国'],units:[],bounds:[105,25,115,35]}]};
  if(city){for(const p of [a,b,c,candidate])Object.assign(p,{cityId:'sample',districtId:'D'});
    data.scopes.push({id:'city:sample',name:'城市',english:'CITY',level:'city',parent:'a',countries:['甲国'],units:[{id:'D',name:'区'}],cityId:'sample'});
    data.cities={sample:{places:data.places,routes,trips:[],tracks:[]}};
    data.geometries['city:sample']={features:[{id:'D',properties:{name:'区'},geometry:{type:'Polygon',coordinates:[[[105,25],[115,25],[115,35],[105,35],[105,25]]]}}]};
  }
  return data;
}

for(const city of [false,true])test((city?'城市':'地区')+'只画内部结构虚线，不制造海外节点或候选独立点，真实路径优先',()=>{
  const data=fixture(city),engine=createScopeEngine(data),view=engine.query(city?'city:sample':'a'),svg=mapMarkup(data,engine,view);
  assert.doesNotMatch(svg,/<circle class="(?:city-)?gateway"/);
  assert.equal((svg.match(/data-structural-link="true"/g)||[]).length,1);
  assert.doesNotMatch(svg,/data-node="Q"/);assert.doesNotMatch(svg,/<title>不应显示的海外节点/);
  assert.equal(view.routes.filter(isRecordedMovement).length,1);
  assert.match(svg,city?/<path class="city-route(?:\s|\")/ : /<path class="route"[^>]+>/);
});
