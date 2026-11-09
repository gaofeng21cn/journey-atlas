import {fitProjection} from './scope-model.mjs';
import {unwrapLongitude} from './geographic-fit.mjs';

// Insets change only the display projection, never the underlying coordinates.
export function mapFrames(scope){
  if(scope.displayFrames)return scope.displayFrames;
  const main={bounds:scope.bounds,extent:[135,32,730,548]};
  if(scope.id==='world')return [{bounds:scope.bounds,extent:[45,25,910,560]}];
  if(scope.id==='japan')return [
    {bounds:[128.3,30.3,146.3,45.8],extent:[145,16,710,540]},
    {ids:['JP-47'],bounds:[122.8,24,129,28.2],extent:[740,470,185,125],label:'冲绳诸岛'}];
  if(scope.insets?.length){main.extent=[135,35,730,420];return [main,...scope.insets.map((f,i)=>({...f,extent:[160+i*235,480,200,115]}))];}
  return [main];
}
export function frameProject(frame){const [x,y,w,h]=frame.extent,project=fitProjection(frame.bounds,w,h,0);return ([lat,lon])=>{if(frame.wrapLongitude)lon=unwrapLongitude(lon,(frame.bounds[0]+frame.bounds[2])/2);const a=project([lat,lon]);return[a[0]+x,a[1]+y];};}
export function frameContains(frame,[lat,lon]){const [w,s,e,n]=frame.bounds;if(frame.wrapLongitude)lon=unwrapLongitude(lon,(w+e)/2);return lon>=w&&lon<=e&&lat>=s&&lat<=n;}
export function frameFor(frames,node){return frames.slice(1).find(f=>f.ids?.includes(node.unitId)||!node.unitId&&Number.isFinite(node.lat)&&frameContains(f,[node.lat,node.lon]))||frames[0];}
