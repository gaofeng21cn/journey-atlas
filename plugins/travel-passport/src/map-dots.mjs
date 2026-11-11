import {mapFrames,frameProject} from './map-frames.mjs';
const inRing=([x,y],ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)yes=!yes;
}return yes;};
export function sampleMapDots(scope,geo){
  const frames=mapFrames(scope),dots=[];
  for(const f of geo.features){
    const frame=frames.slice(1).find(frame=>frame.ids?.includes(f.id))||frames[0],project=frameProject(frame);
    const step=Math.max(scope.step??.115,4.2/Math.abs(project([0,1])[0]-project([0,0])[0]));
    const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const original of polys){
      const poly=f.id==='US-AK'?original.map(r=>r.map(([lon,lat])=>[lon>0?lon-360:lon,lat])):original;
      const xs=poly[0].map(p=>p[0]),ys=poly[0].map(p=>p[1]);
      const [fw,fs,fe,fn]=frame.bounds,w=Math.max(fw,Math.min(...xs)),e=Math.min(fe,Math.max(...xs)),s=Math.max(fs,Math.min(...ys)),n=Math.min(fn,Math.max(...ys));
      for(let lon=Math.ceil(w/step)*step;lon<=e;lon+=step)for(let lat=Math.ceil(s/step)*step;lat<=n;lat+=step){
        if(inRing([lon,lat],poly[0])&&!poly.slice(1).some(r=>inRing([lon,lat],r)))dots.push([+lon.toFixed(4),+lat.toFixed(4),f.id]);
      }
    }
  }
  return dots;
}
