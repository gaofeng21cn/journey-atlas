import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT} from './data.mjs';
import {collectCitiesEvidence} from './city-evidence.mjs';
// Private paths are supplied locally; they are never embedded in public code.
const [configPath,...ids]=process.argv.slice(2);
if(!configPath)throw new Error('用法：node scripts/collect-city-evidence.mjs 私有来源配置.json [城市编号...]');
const sources=JSON.parse(await readFile(configPath,'utf8')),catalog=JSON.parse(await readFile(join(ROOT,'data/city-catalog.json'),'utf8'));
const selected=catalog.filter(c=>!c.deriveFrom&&!c.useGlobal&&(!ids.length||ids.includes(c.id)));
const cities=await Promise.all(selected.map(async c=>({id:c.id,timeZone:c.timeZone,geometry:JSON.parse(await readFile(join(ROOT,'data',c.boundaryFile),'utf8'))})));
const results=await collectCitiesEvidence({...sources,cities}),output=join(ROOT,'private/runtime/city-evidence');await mkdir(output,{recursive:true});
for(const c of selected){const evidence=results[c.id];await writeFile(join(output,c.id+'-evidence.json'),JSON.stringify(evidence));console.log(c.id,JSON.stringify(evidence.summary));}
