import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopeEngine} from '../src/scope-model.mjs';
import {cityMapMarkup,cityMapFrame} from '../src/city-map.mjs';

function fixture(){
  const home={id:'H',name:'市内地点',country:'甲国',cityId:'sample',districtId:'D',lat:5,lon:5,active:true,visited:true};
  const other={...home,id:'B',name:'第二地点',lat:8,lon:7};
  const away={...home,id:'X',name:'邻城',cityId:null,lat:6,lon:20,active:false,visited:false,level:'定位节点'};
  const local={...away,id:'L',name:'同城机场',cityId:'sample',lat:5,lon:-5};
  const movement=(id,nodes,extra={})=>({id,nodes,date:'2020-01-01',mode:'地面交通',km:10,travelMinutes:30,reconstructed:true,geometryType:'model',...extra});
  const routes=[movement('OUT',[home,away]),movement('IN',[away,home]),movement('LOCAL',[local,home]),
    movement('OBSERVED',[home,other],{geometryType:'observed',path:[[5,5],[14,6],[7,8]]})];
  const scope={id:'city:sample',name:'样例',english:'SAMPLE',level:'city',parent:'world',cityId:'sample',countries:['甲国'],units:[{id:'D',name:'区'}]};
  const geo={features:[{id:'D',properties:{name:'区'},geometry:{type:'Polygon',coordinates:[[[0,0],[10,0],[10,2],[2,2],[2,10],[0,10],[0,0]]]}}]};
  const data={meta:{totalKm:40,flightMinutes:0,nodes:4},places:[home,other],routes:[],dots:[],contexts:{},
    scopes:[{id:'world',name:'全球',level:'world',countries:['甲国'],units:[]},scope],geometries:{'city:sample':geo},
    cities:{sample:{places:[home,other],routes:[],inferredRoutes:routes,trips:[],tracks:[]}}};
  const engine=createScopeEngine(data),view=engine.query(scope.id);
  return {data,engine,view,frame:cityMapFrame(scope,geo,view)};
}
const attribute=(tag,name)=>tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const endpoints=d=>{const nums=d.match(/-?\d+(?:\.\d+)?/g).map(Number);return [nums.slice(0,2),nums.slice(-2)];};

test('重建跨界移动接到同一个边缘节点，入出方向和真实市内端点均保留',()=>{
  const {data,engine,view,frame}=fixture(),svg=cityMapMarkup(data,engine,view);
  const edges=[...svg.matchAll(/<path class="city-route edge"[^>]+>/g)].map(m=>m[0]);
  const gateways=[...svg.matchAll(/<circle class="city-gateway"[^>]+>/g)].map(m=>m[0]);
  assert.equal(edges.length,3);assert.equal(gateways.length,2);
  assert.deepEqual(edges.slice(0,2).map(e=>attribute(e,'data-inbound')).sort(),['false','true']);
  for(const edge of edges){
    const gateway=gateways.find(g=>attribute(g,'data-gateway-node')===attribute(edge,'data-gateway'));
    assert.ok(gateway,'每条出入线都有可见的边缘节点');
    assert.ok(svg.indexOf(gateway)>svg.indexOf(edge),'页边节点绘制在线路之上');
    const g=[Number(attribute(gateway,'cx')),Number(attribute(gateway,'cy'))];
    const home=view.routes.flatMap(r=>r.nodes).find(n=>n.id===attribute(edge,'data-home'));
    const h=frame.project([home.lat,home.lon]),expected=attribute(edge,'data-inbound')==='true'?[g,h]:[h,g];
    for(const [i,p]of endpoints(attribute(edge,'d')).entries())assert.ok(Math.hypot(p[0]-expected[i][0],p[1]-expected[i][1])<.03);
  }
  assert.match(svg,/同城机场/); // Outside-window local nodes are not cropped interior strokes.
  assert.equal(view.stats.places,2);assert.equal(view.stats.km,20); // Drawing does not change accounting.
});

test('主行程不被行政凹边界截断，出窗后返城的观测保留完整端点',()=>{
  const {data,engine,view}=fixture(),svg=cityMapMarkup(data,engine,view);
  const path=svg.match(/<path class="city-route observed flow"[^>]+>/)?.[0];
  assert.ok(path);assert.match(attribute(path,'d'),/Q/);
  const nums=attribute(path,'d').match(/-?\d+(?:\.\d+)?/g).map(Number);
  for(let i=0;i<nums.length;i+=2){assert.ok(nums[i]>=155&&nums[i]<=845);assert.ok(nums[i+1]>=55&&nums[i+1]<=555);}
  const groups=[];
  for(const tag of svg.slice(0,svg.indexOf(path)).matchAll(/<g\b[^>]*>|<\/g>/g)){
    if(tag[0]==='</g>')groups.pop();else groups.push(tag[0]);
  }
  assert.ok(groups.every(g=>!g.includes('city-boundary-clip')&&!g.includes('city-map-window')),'主行程位于行政裁剪组之外');
  assert.match(svg,/data-node="H"/);assert.match(svg,/data-node="B"/);
});

test('画幅内无法分辨的短移动不生成空路径，原移动和计量仍保留',()=>{
  const {data,engine,view}=fixture(),home=view.routes[0].nodes[0];
  const nearby={...home,id:'NEAR',lat:home.lat+.00001};
  view.routes.push({id:'SHORT',nodes:[home,nearby],mode:'步行',reconstructed:true,geometryType:'model',km:.001,travelMinutes:.02});
  const svg=cityMapMarkup(data,engine,view);
  assert.doesNotMatch(svg,/<path class="city-route[^>]* d=""/);
  assert.ok(view.routes.some(r=>r.id==='SHORT'&&r.km===.001));
});

test('全时段城市图不在无明确阅读焦点时堆叠主行程箭头',()=>{
  const {data,engine,view}=fixture(),svg=cityMapMarkup(data,engine,view);
  assert.match(svg,/data-directional="false"/);
  assert.doesNotMatch(svg,/\smarker-end=/);
  assert.match(svg,/data-gateway-label=/);
});

test('单日筛选恢复主行程方向并把终点套在可见节点上',()=>{
  const {data,engine,view}=fixture();
  view.filters={date:'2020-01-01'};
  const svg=cityMapMarkup(data,engine,view);
  assert.match(svg,/data-directional="true"/);
  assert.match(svg,/class="city-route observed flow"[^>]*marker-end="url\(#city-flow-arrow\)"/);
  assert.match(svg,/class="city-route-endpoint" data-endpoint-node="B"/);
  assert.match(svg,/class="city-route-endpoint" data-endpoint-node="H"/);
  assert.doesNotMatch(svg,/data-gps-track="true"[^>]*marker-end=/);
});

test('没有命名端点的GPS纹理不生成方向箭头，短行程也不挤入箭头',()=>{
  const {data,engine,view}=fixture(),home=view.routes[0].nodes[0];
  view.filters={date:'2020-01-01'};view.flowStyle='flow';
  view.tracks=Array.from({length:21},()=>({date:'2020-01-01',points:Array.from({length:9},(_,i)=>[5+i*.1,5+i*.1])}));
  view.routes.push({id:'SHORT-ARROW',nodes:[home,{...home,id:'NEAR',lat:home.lat+.05}],mode:'步行',reconstructed:false,km:5});
  const svg=cityMapMarkup(data,engine,view);
  assert.match(svg,/class="gps-track gps-flow"/);
  assert.doesNotMatch(svg,/data-gps-track="true"[^>]*marker-end=/);
  const short=svg.match(/<path class="city-route walking flow"[^>]*data-to="NEAR"[^>]*>/)?.[0];
  assert.ok(short);assert.doesNotMatch(short,/marker-end=/);
});
