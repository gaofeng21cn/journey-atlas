const overlap=(a,b,padding=5)=>a.x<b.x+b.w+padding&&a.x+a.w+padding>b.x&&a.y<b.y+b.h+padding&&a.y+a.h+padding>b.y;
const widthOf=name=>[...name].reduce((sum,c)=>sum+(/[\u0000-\u007f]/.test(c)?8:14),0)+4;

export function rankPlaces(view){
  return view.places.map(p=>({...p,frequency:view.routes.filter(r=>r.nodes.some(n=>n.id===p.id||n.name===p.name)).length}))
    .sort((a,b)=>b.frequency-a.frequency||a.name.localeCompare(b.name,'zh-CN'));
}

// Sparse maps label every place; dense maps select frequent, separated hubs.
export function placeLabels(view,frames,frameFor,reserved=[]){
  const points=rankPlaces(view).map(p=>{const frame=frameFor(frames,p),[x,y]=frame.project([p.lat,p.lon]);return {...p,x,y,frame};});
  const sparse=points.length<=8,budget=sparse?points.length:view.scope.id==='world'?8:12;
  const obstacles=[...reserved,...points.map(p=>({x:p.x-4,y:p.y-4,w:8,h:8}))],labels=[];
  for(const p of points){
    if(labels.length>=budget)break;
    const [fx,fy,fw,fh]=p.frame.extent;
    if(p.x<fx||p.x>fx+fw||p.y<fy||p.y>fy+fh)continue;
    if(!sparse&&labels.some(l=>Math.hypot(l.nodeX-p.x,l.nodeY-p.y)<58))continue;
    const preferred=view.scope.labels?.find(l=>l[0]===p.name)?.slice(1),offsets=preferred?[preferred]:[];
    for(let d=18;d<=250;d+=18)offsets.push([d,-12],[d,20],[-d,-12],[-d,20],[d,-d],[-d,-d],[d,d],[-d,d]);
    const w=widthOf(p.name);let best;
    for(const [dx,dy]of offsets){
      const anchor=dx<0?'end':'start',tx=p.x+dx,ty=p.y+dy,box={x:anchor==='end'?tx-w:tx,y:ty-14,w,h:18};
      if(box.x<Math.max(8,fx-20)||box.x+w>Math.min(992,fx+fw+20)||box.y<Math.max(12,fy)||box.y+18>Math.min(610,fy+fh))continue;
      if(obstacles.some(o=>overlap(box,o))||labels.some(l=>overlap(box,l.box)))continue;
      best={id:p.id,name:p.name,x:tx,y:ty,anchor,nodeX:p.x,nodeY:p.y,box};break;
    }
    if(best)labels.push(best);
  }
  return labels;
}
