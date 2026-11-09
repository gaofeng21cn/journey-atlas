import {join,relative} from 'node:path';
import {mkdir,writeFile,readdir} from 'node:fs/promises';

const safe=s=>String(s).replace(/[\\/:]/g,'-');
export function passportAsset(output,{kind='region',name,country,variant='分享',format='png'}){
  country=({'中国香港':'香港','中国澳门':'澳门'}[country]||country);
  const root=kind==='flight'||kind==='world'?'01_全球护照':kind==='city'?'03_城市护照':'02_地区护照';
  const folders=[root];
  const stem=(kind==='flight'?'飞行护照':'旅行护照')+'-'+safe(name)+'-'+variant;
  return join(output,...(format==='png'?[]:['html']),...folders,stem+'.'+format);
}
export async function prepareAsset(path){await mkdir(join(path,'..'),{recursive:true});return path;}
export async function writeOutputGuide(output){
  const assets=[];const scan=async folder=>{let entries;try{entries=await readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const e of entries){const path=join(folder,e.name);if(e.isDirectory())await scan(path);else if(e.name.endsWith('.png'))assets.push({path,label:e.name.replace(/\.png$/,'')});}};
  for(const root of ['01_全球护照','02_地区护照','03_城市护照'])await scan(join(output,root));assets.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'));
  const groups=new Map();for(const a of assets){const path=relative(output,a.path),group=path.split('/')[0];if(!groups.has(group))groups.set(group,[]);groups.get(group).push({...a,path});}
  const lines=['# 旅行护照输出','','图片只分全球、地区、城市三类，直接放在对应目录，不再按国家或城市增加文件夹。“分享”不含姓名，“个人”保留署名。更新源在上级整理说明，输出由 app 统一生成。',''];
  for(const [group,items]of groups){lines.push('## '+group,'');for(const a of items)lines.push('- ['+a.label+'](<'+a.path+'>)');lines.push('');}
  lines.push('其他文件：`html/` 为可复用页面，`data/` 为派生表，`checks/` 为当前构建回执，`site/` 为本地网站。这里只保留当前输出；旧版恢复包统一在 app 的 `private/history/`，浏览器检查图在 `private/runtime/browser-checks/`，不混入成品目录。');
  await writeFile(join(output,'00_查看指南.md'),lines.join('\n')+'\n');
}
