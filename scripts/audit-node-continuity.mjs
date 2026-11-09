import {readAtlasConfig,sourcePath} from './source-data.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {loadAtlas,parseCsv,csv} from './atlas-data.mjs';
import {ROOT,readJson} from './data.mjs';
import {createContinuityAudit,AUDIT_HEADERS} from './continuity-audit.mjs';
import {TABLES} from './schema.mjs';

const {values,positionals}=parseArgs({allowPositionals:true,options:{vault:{type:'string'},output:{type:'string'}}});
const cfg=await readAtlasConfig();
const {atlas,source}=await loadAtlas(values.vault,{}, {validateDates:false});
const candidates=parseCsv(await readFile(sourcePath(source,TABLES.visitCandidates),'utf8'));
const report=createContinuityAudit(atlas,candidates);
const outDir=resolve(values.output||positionals[0]||join(cfg.output||join(ROOT,'outputs'),'checks'));
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'全旅程数据点-节点连续性审计.csv'),csv(report.rows,AUDIT_HEADERS));
await writeFile(join(outDir,'全旅程数据点-节点连续性审计.json'),JSON.stringify({generatedAt:new Date().toISOString(),...report},null,2)+'\n');
console.log(JSON.stringify({...report.summary,output:join(outDir,'全旅程数据点-节点连续性审计.csv')},null,2));
