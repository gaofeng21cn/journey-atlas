// A review decision is separate from raw GPS, tickets and map geometry. This
// module checks that the decision is explicit and traceable; it never decides
// whether a visit or a means of transport happened from keywords or proximity.
export const EVIDENCE_HEADERS=Object.freeze(['核定结论','核定方式','证据引用','核定记录']);
// A place row that has been decided is never left as '待核'. Non-visit,
// already-reviewed classifications get their own explicit states so the
// pending queue only contains genuinely undecided rows.
export const PLACE_CONCLUSIONS=Object.freeze(['地面到访','交通接触','行政归属','已排除','待核','计划']);
export const MOVEMENT_CONCLUSIONS=Object.freeze(['已发生','合理重构','待核','计划','排除']);
export const REVIEW_METHODS=Object.freeze(['本人确认','证据复核','历史迁移']);

const value=(row,...keys)=>{
  for(const key of keys){const found=row?.[key];if(found!==undefined&&found!==null&&String(found).trim()!=='')return found;}
  return '';
};
const text=x=>String(x??'').trim();
export const evidenceReferences=x=>Array.isArray(x)?x.map(text).filter(Boolean):text(x).split(/[；\n]/).map(text).filter(Boolean);
const placeStatus=row=>text(value(row,'到访状态','status'));
const statusConclusion=status=>({已到访:'地面到访','途经/机场':'交通接触',交通节点:'交通接触',行政归属:'行政归属',已排除:'已排除',待核:'待核',计划:'计划'})[status]||'';

export function evidenceFields(row,{kind='place'}={}){
  const basis=text(value(row,kind==='place'?'核定依据':'发生依据','evidence','occurrenceBasis','basis'));
  const source=text(value(row,'关联正文','source'));
  return {conclusion:text(value(row,'核定结论','evidenceConclusion','conclusion','核定状态')),
    method:text(value(row,'核定方式','evidenceMethod','reviewMethod','method')),
    references:evidenceReferences(value(row,'证据引用','evidenceReferences','references')),
    record:text(value(row,'核定记录','reviewRecord','evidenceRecord','record')),basis,source};
}

// An unknown measurement cannot supply a counted value. Keep the retired
// untyped archives readable, while sharing this invariant across all new and
// explicitly typed global, city and aviation movement rows.
export function measurementEvidenceErrors(row){
  if(text(row['计程纳入'])==='否')return [];
  const errors=[],positive=x=>text(x)!==''&&Number.isFinite(Number(x))&&Number(x)>0;
  const distance=Object.hasOwn(row,'统计采用里程公里')?row['统计采用里程公里']:value(row,'里程公里','km');
  if(text(row['里程类型'])==='unknown'&&(positive(distance)||text(row['距离模型'])))errors.push('未知里程不能携带纳入计程的正数或距离模型');
  if(text(row['时长类型'])==='unknown'&&['交通时长分钟','飞行时长分钟','travelMinutes','minutes'].some(k=>positive(row[k])))errors.push('未知时长不能携带纳入计时的正数');
  return errors;
}

function validate(row,{legacy=false,city=false,allowHistoricalMigration=false}={},kind){
  const evidence=evidenceFields(row,{kind}),errors=[];
  if(kind==='movement')errors.push(...measurementEvidenceErrors(row));
  const supplied=Boolean(evidence.conclusion||evidence.method||evidence.references.length||evidence.record);
  // Read compatibility is deliberately visible. Missing fields are not silently
  // represented as a new evidence review, and update/promotion never use it.
  if(legacy&&!supplied){
    return {ok:!errors.length,errors,evidence:{...evidence,
      conclusion:kind==='place'?statusConclusion(placeStatus(row)):'',
      method:'历史迁移',references:evidence.source?[evidence.source]:[],record:evidence.basis,legacy:true,city}};
  }
  const conclusions=kind==='place'?PLACE_CONCLUSIONS:MOVEMENT_CONCLUSIONS;
  if(!conclusions.includes(evidence.conclusion))errors.push(`${kind==='place'?'地点':'移动'}核定结论无效或缺失`);
  if(!REVIEW_METHODS.includes(evidence.method))errors.push('核定方式无效或缺失');
  if(evidence.method==='历史迁移'&&!legacy&&!allowHistoricalMigration)errors.push('新记录或晋级不能以历史迁移代替核定');
  if(!evidence.references.length)errors.push('核定缺少可追溯证据引用');
  if(!evidence.record)errors.push('核定缺少记录');
  if(kind==='place'){
    const status=placeStatus(row),expected=statusConclusion(status);
    if(expected&&evidence.conclusion!==expected)errors.push(`到访状态 ${status} 与核定结论 ${evidence.conclusion} 不一致`);
  }else if(!evidence.basis){
    errors.push('移动缺少发生依据');
  }
  return {ok:!errors.length,errors,evidence:{...evidence,legacy:evidence.method==='历史迁移',city}};
}

export const validatePlaceEvidence=(row,options={})=>validate(row,options,'place');
export const validateMovementEvidence=(row,options={})=>validate(row,options,'movement');
