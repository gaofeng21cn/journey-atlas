(function(){
  'use strict';
  const data=window.ATLAS_DATA,NS='http://www.w3.org/2000/svg';
  const project=p=>[(p[1]+180)/360*1000,(76-p[0])/122*372];
  const node=(tag,attrs)=>{const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));return e;};
  const visited=new Set(data.countries.map(c=>c.name));
  const dots=document.getElementById('mapDots');
  for(const [lon,lat,country] of window.WORLD_DOTS){const [x,y]=project([lat,lon]);dots.appendChild(node('circle',{cx:x,cy:y,r:1.2,class:'map__dot'+(visited.has(country)?' map__dot--visited':'')}));}
  // The world plate is one scale for the whole planet. Intra-city movement is
  // real and already counted, but below roughly 150 km it collapses to a few
  // pixels and only adds noise, so the global drawing keeps the long-haul
  // skeleton that actually reads as “行万里路”. Those short legs stay
  // visible in the regional and city passports.
  const GROUND_MIN_KM=150;
  const greatCircleKm=(a,b)=>{const R=6371,d=Math.PI/180;const dp=(b[1]-a[1])*d,dl=(b[0]-a[0])*d;
    const x=Math.sin(dp/2)**2+Math.cos(a[1]*d)*Math.cos(b[1]*d)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,x)));};
  // Arc height follows how far apart the two endpoints are drawn, matching the
  // flight passport: domestic hops stay almost straight while intercontinental
  // routes sweep. Ground legs stay deliberately low.
  const arcs=document.getElementById('mapArcs');
  // Journeys dedupe by direction so the return of a round trip survives; a
  // registered A->B and its B->A twin then draw as a mirrored pair. Structural
  // continuations dedupe by endpoint-ordered pair, because one physical
  // connection registered twice is still one connection.
  const seenDirections=new Set(),seenPairs=new Set(),seenStructural=new Set(),coveredPairs=new Set();
  const ordered=(a,b)=>{const x=a.map(v=>v.toFixed(1)).join(','),y=b.map(v=>v.toFixed(1)).join(',');return x<y?x+'|'+y:y+'|'+x;};
  const air=[],ground=[];
  for(const route of data.routes){
    if(route.structuralLink||route.candidate||route.recordType==='节点对应')continue;
    const points=route.displayPoints||route.points;
    for(let i=1;i<points.length;i++){
      const km=greatCircleKm(points[i-1],points[i]);
      if(route.mode!=='飞机'&&km<GROUND_MIN_KM)continue;
      const [a,b]=[project(points[i-1]),project(points[i])];
      const direction=a.map(v=>v.toFixed(1)).join(',')+'>'+b.map(v=>v.toFixed(1)).join(',');
      if(seenDirections.has(direction))continue;
      seenDirections.add(direction);
      const pairKey=ordered(a,b);
      coveredPairs.add(pairKey);
      // A round trip is a symmetric lens: the perpendicular flips with the
      // drawn direction, so outbound and return bow to opposite sides and
      // neither hides the other. No extra sign flip is applied here.
      const twin=seenPairs.has(pairKey);seenPairs.add(pairKey);
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;
      const perp=[-dy/len,dx/len],isFlight=route.mode==='飞机';
      const height=isFlight?Math.min(len*.12,110):Math.min(len*.03,26);
      const cx=(a[0]+b[0])/2+perp[0]*height*2,cy=(a[1]+b[1])/2+perp[1]*height*2;
      (isFlight?air:ground).push({d:`M${a[0]},${a[1]}Q${cx},${cy} ${b[0]},${b[1]}`,
        cls:isFlight?(route.km>=4000?'map__arc map__arc--long':'map__arc')+(twin?' map__arc--return':''):'map__arc map__arc--ground'});
    }
  }
  for(const arc of [...ground,...air])arcs.appendChild(node('path',{class:arc.cls,d:arc.d}));
  // Structural continuations draw last and stay faint: they close a chain
  // rather than competing with the journeys actually travelled, and are
  // skipped where a recorded journey already covers the same pair.
  for(const route of data.routes){
    if(route.recordType==='节点对应'||!(route.structuralLink||route.candidate))continue;
    const points=route.displayPoints||route.points;if(!points)continue;
    for(let i=1;i<points.length;i++){
      const [a,b]=[project(points[i-1]),project(points[i])];
      const pairKey=ordered(a,b);
      if(coveredPairs.has(pairKey)||seenStructural.has(pairKey))continue;
      seenStructural.add(pairKey);
      const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(!len)continue;
      const perp=[-dy/len,dx/len],bow=Math.min(len*.05,90);
      arcs.appendChild(node('path',{class:'map__arc map__arc--connection',style:'stroke-dasharray:3 4;opacity:.26;stroke-width:.8',
        d:`M${a[0]},${a[1]}Q${(a[0]+b[0])/2+perp[0]*bow},${(a[1]+b[1])/2+perp[1]*bow} ${b[0]},${b[1]}`}));
    }
  }
  // Journey density is expressed once, through node weight. Keeping node radii
  // modest stops the Asian cluster from closing into a single red mass.
  // Airports, city centres and their districts sit within a few kilometres of
  // each other, so at world scale they collapse into one mark; otherwise a
  // single metro area (二亲三州) paints five overlapping red dots that read as
  // false density.
  const max=Math.max(...data.nodes.map(p=>p.n));
  const greatCircleDeg=(a,b)=>{const d=Math.PI/180;const x=Math.sin((b[1]-a[1])*d/2)**2+Math.cos(a[1]*d)*Math.cos(b[1]*d)*Math.sin((b[0]-a[0])*d/2)**2;return 2*Math.asin(Math.sqrt(Math.min(1,x)));};
  const nodeGroups=new Map();
  for(const p of [...data.nodes].sort((a,b)=>b.n-a.n)){
    const key=data.nodes.find(q=>greatCircleDeg([q.lat,q.lon],[p.lat,p.lon])<.22)?.id;
    const k=key||p.id;if(!nodeGroups.has(k))nodeGroups.set(k,{lat:p.lat,lon:p.lon,n:0,label:p.name,weight:p.n});
    const g=nodeGroups.get(k);g.n+=p.n;g.weight=Math.max(g.weight,p.n);
  }
  for(const g of nodeGroups.values()){const [x,y]=project([g.lat,g.lon]);document.getElementById('mapNodes').appendChild(node('circle',{cx:x,cy:y,r:1.2+Math.sqrt(g.n/max)*1.8,class:'map-node'}));}
  for(const c of data.countries){const li=document.createElement('li');li.className='stamp';const flag=document.createElement('span');flag.className='stamp__flag';flag.textContent=c.flag||'🌐';li.append(flag,document.createTextNode(c.name));document.getElementById('stamps').appendChild(li);}
  const m=data.meta,fmt=n=>n.toLocaleString('en-US');
  const stats={years:`${m.firstYear} — ${m.lastYear}`,distance:fmt(m.totalKm),earth:(m.totalKm/m.earthKm).toFixed(1),totalHours:fmt(Math.round(m.flightMinutes/60)),flights:m.transportMoves??m.routes,countries:m.countries,cities:m.nodes};
  document.querySelectorAll('[data-stat]').forEach(e=>e.textContent=stats[e.dataset.stat]);
})();
