import {join} from 'node:path';
import {readJson,WORKSPACE_ROOT} from './data.mjs';
import {readAtlasConfig,resolveSource} from './source-data.mjs';
import {loadAtlas} from './atlas-data.mjs';
import {annualView,resolveAnnualMemory} from './annual-data.mjs';
import {createYearReview} from '../src/year-review.mjs';

export async function loadYearReview({year,asOf,includePlanned,theme,style,format,atlas,config,curation}={}){
  config ||= await readAtlasConfig();
  if(!curation){
    const annual=await readJson(join(WORKSPACE_ROOT,'data/annual-config.json')).catch(e=>{if(e.code==='ENOENT')return {years:{}};throw e;});
    curation=annual.years?.[year]||{};
  }
  if(!atlas){const source=await resolveSource({config});atlas=(await loadAtlas(undefined,{}, {source})).atlas;}
  const basePlaceId=curation.basePlaceId||atlas.journeyLayer.journeys.find(j=>j.date?.startsWith(String(year))&&j.baseId)?.baseId;
  const view=annualView(atlas,{year,asOf:asOf||curation.asOf||`${year}-12-31`,basePlaceId,placeGroups:curation.placeGroups||[],includePlanned:includePlanned??curation.review?.includePlanned??false});
  // Curated window memories retain their own route/time scope; yearly planned
  // flights never change which records belong to a past selected window.
  const actual=annualView(atlas,{year,asOf:view.asOf,basePlaceId,placeGroups:curation.placeGroups||[]});
  view.memory=resolveAnnualMemory(actual,curation.memory);
  const profile={...curation.review};
  if(profile.memory?.range)profile.memory=resolveAnnualMemory(actual,profile.memory);
  return {model:createYearReview(view,{theme:theme||profile.theme||'life',style:style||profile.style||'paper',format:format||profile.format||'single',profile}),view,config,atlas,curation};
}
