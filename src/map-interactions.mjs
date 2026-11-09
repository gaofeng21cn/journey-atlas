export function bindMapViewport(stage){
  const svg=stage.querySelector('svg');if(!svg)return;
  const initial={x:0,y:0,w:1000,h:640},view={...initial};let zoom=1,drag;
  const update=()=>svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
  const resize=factor=>{const next=Math.max(1,Math.min(6,zoom*factor)),cx=view.x+view.w/2,cy=view.y+view.h/2;zoom=next;view.w=1000/zoom;view.h=640/zoom;view.x=Math.max(0,Math.min(1000-view.w,cx-view.w/2));view.y=Math.max(0,Math.min(640-view.h,cy-view.h/2));update();};
  const canvas=stage.closest('.map-canvas');
  canvas.querySelectorAll('[data-map-zoom]').forEach(b=>b.onclick=()=>{if(b.dataset.mapZoom==='reset'){zoom=1;Object.assign(view,initial);update();}else resize(b.dataset.mapZoom==='in'?1.5:1/1.5);});
  svg.addEventListener('pointerdown',e=>{if(zoom===1)return;drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};});
  svg.addEventListener('pointermove',e=>{if(!drag)return;const box=svg.getBoundingClientRect(),dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved||=Math.hypot(dx,dy)>5;
    view.x=Math.max(0,Math.min(1000-view.w,drag.vx-dx/box.width*view.w));view.y=Math.max(0,Math.min(640-view.h,drag.vy-dy/box.height*view.h));update();});
  svg.addEventListener('click',e=>{if(drag?.moved){e.stopImmediatePropagation();drag=null;}},{capture:true});
  svg.addEventListener('pointerleave',()=>drag=null);
  svg.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();resize(e.deltaY<0?1.15:1/1.15);},{passive:false});
}
