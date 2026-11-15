export function bindMapViewport(stage){
  const svg=stage.querySelector('svg');if(!svg)return;
  const canvas=stage.closest('.map-canvas'),panControls=canvas.querySelector('.map-pan');
  const initial={x:0,y:0,w:1000,h:640},view={...initial};let zoom=1,drag,suppressClick=false;
  const clamp=()=>{view.x=Math.max(0,Math.min(1000-view.w,view.x));view.y=Math.max(0,Math.min(640-view.h,view.y));};
  const update=()=>{clamp();svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);svg.classList.toggle('is-zoomed',zoom>1);panControls.hidden=zoom===1;};
  const resize=factor=>{const next=Math.max(1,Math.min(6,zoom*factor)),cx=view.x+view.w/2,cy=view.y+view.h/2;
    zoom=next;view.w=1000/zoom;view.h=640/zoom;view.x=cx-view.w/2;view.y=cy-view.h/2;update();};
  const pan=(dx,dy)=>{view.x+=dx*view.w;view.y+=dy*view.h;update();};
  const directions={left:[-.2,0],right:[.2,0],up:[0,-.2],down:[0,.2]};
  canvas.querySelectorAll('[data-map-zoom]').forEach(b=>b.onclick=()=>{if(b.dataset.mapZoom==='reset'){zoom=1;Object.assign(view,initial);update();}else resize(b.dataset.mapZoom==='in'?1.5:1/1.5);});
  canvas.querySelectorAll('[data-map-pan]').forEach(b=>b.onclick=()=>pan(...directions[b.dataset.mapPan]));
  stage.onkeydown=e=>{if(e.target!==stage||zoom===1)return;const direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];
    if(direction){e.preventDefault();pan(...directions[direction]);}};
  svg.addEventListener('pointerdown',e=>{if(zoom===1||!e.isPrimary||e.button!==0||drag)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};});
  svg.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)>5){drag.moved=true;svg.classList.add('is-panning');try{svg.setPointerCapture(e.pointerId);}catch{ /* Synthetic pointers need not have capture. */ }}
    if(!drag.moved)return;const box=svg.getBoundingClientRect();view.x=drag.vx-dx/box.width*view.w;view.y=drag.vy-dy/box.height*view.h;update();});
  const finish=(e,cancelled=false)=>{if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved;drag=null;svg.classList.remove('is-panning');
    if(!cancelled&&moved){suppressClick=true;setTimeout(()=>{suppressClick=false;},0);}
    if(svg.hasPointerCapture?.(e.pointerId))svg.releasePointerCapture(e.pointerId);};
  svg.addEventListener('pointerup',e=>finish(e));
  svg.addEventListener('pointercancel',e=>finish(e,true));
  svg.addEventListener('lostpointercapture',e=>finish(e,true));
  svg.addEventListener('pointerleave',e=>{if(drag&&!svg.hasPointerCapture?.(drag.id))finish(e,true);});
  svg.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  svg.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();resize(e.deltaY<0?1.15:1/1.15);},{passive:false});
  update();
}
