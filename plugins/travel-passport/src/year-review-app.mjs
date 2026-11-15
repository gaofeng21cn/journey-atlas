import {reviewThemes,reviewStyles,reviewFormats,selectYearReview,reviewPageSvg} from './year-review.mjs';
const models=JSON.parse(document.getElementById('review-data').textContent);
const defaults=JSON.parse(document.getElementById('review-defaults').textContent);
const $=id=>document.getElementById(id),form=$('review-options');
for(const [name,choices,defaultValue]of [['theme',reviewThemes,'life'],['style',reviewStyles,'paper'],['format',reviewFormats,'single']]){
  for(const c of choices){const label=document.createElement('label');label.className='choice';const input=document.createElement('input');input.type='radio';input.name=name;input.value=c.id;input.checked=c.id===(defaults[name]||defaultValue);label.append(input,document.createTextNode(c.name));$(name+'-options').append(label);}
}
for(const year of [...new Set(models.map(m=>m.year))].sort((a,b)=>b-a)){const option=document.createElement('option');option.value=String(year);option.textContent=String(year);$('review-year').append(option);}
$('review-year').value=String(defaults.year||models[0]?.year||'');
$('include-planned').checked=Boolean(defaults.includePlanned??models[0]?.travelPolicy.includePlanned);
const download=(blob,name)=>{const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function savePng(svg,name){
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{await document.fonts.ready;const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1600;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片暂未生成，请重试');download(blob,name);}
  finally{URL.revokeObjectURL(url);}
}
function preview(){
  if(!models.length)throw new Error('暂无年度资料。请先导入旅行记录，或从 App 的“制作年度总结”入口选择年度。');
  const data=new FormData(form),year=Number(data.get('year')),planned=data.has('include-planned');
  const base=models.find(m=>m.year===year&&Boolean(m.travelPolicy.includePlanned)===planned);
  if(!base)throw new Error('这一年暂无所选待飞口径，请通过年度总结入口生成后再打开。');
  const model=selectYearReview(base,{theme:data.get('theme'),style:data.get('style'),format:data.get('format')});
  $('review-pages').replaceChildren();$('page-count').textContent=`${model.pages.length} 张 · ${model.format==='single'?'一页总览':'朋友圈最多九张'}`;
  model.pages.forEach((p,i)=>{const card=document.createElement('article');card.className='review-card';const svg=reviewPageSvg(model,i);card.innerHTML=svg;const heading=document.createElement('h3');heading.textContent=`${i+1}. ${p.title}`;card.append(heading);const footer=document.createElement('footer');const png=document.createElement('button');png.type='button';png.textContent='保存 PNG';const stem=`年度总结-${year}-${model.theme}-${model.style}-${String(i+1).padStart(2,'0')}`;
    png.addEventListener('click',async()=>{png.disabled=true;try{await savePng(svg,stem+'.png');$('review-status').textContent='已生成图片，可在下载中查看。';}catch(e){$('review-status').textContent=e.message;}finally{png.disabled=false;}});
    const editable=document.createElement('button');editable.type='button';editable.textContent='保存可编辑 SVG';editable.addEventListener('click',()=>download(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),stem+'.svg'));footer.append(png,editable);card.append(footer);$('review-pages').append(card);});
  $('review-status').textContent='';
}
function showError(error){$('review-pages').replaceChildren();$('page-count').textContent='';$('review-status').textContent=error.message;}
form.addEventListener('submit',e=>{e.preventDefault();try{preview();}catch(error){showError(error);}});
try{preview();}catch(error){showError(error);}
