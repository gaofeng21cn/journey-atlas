import {mapFrames,frameProject} from './map-frames.mjs';
import {pointInPolygon,polygonBbox,unwrapAntimeridianPolygons} from './geo.mjs';
export function sampleMapDots(scope,geo){
  const frames=mapFrames(scope),dots=[];
  for(const f of geo.features){
    const frame=frames.slice(1).find(frame=>frame.ids?.includes(f.id))||frames[0],project=frameProject(frame);
    const step=Math.max(scope.step??.115,4.2/Math.abs(project([0,1])[0]-project([0,0])[0]));
    for(const poly of unwrapAntimeridianPolygons(f)){
      const [bw,bs,be,bn]=polygonBbox(poly);
      const [fw,fs,fe,fn]=frame.bounds,w=Math.max(fw,bw),e=Math.min(fe,be),s=Math.max(fs,bs),n=Math.min(fn,bn);
      for(let lon=Math.ceil(w/step)*step;lon<=e;lon+=step)for(let lat=Math.ceil(s/step)*step;lat<=n;lat+=step){
        if(pointInPolygon([lon,lat],poly))dots.push([+lon.toFixed(4),+lat.toFixed(4),f.id]);
      }
    }
  }
  return dots;
}
