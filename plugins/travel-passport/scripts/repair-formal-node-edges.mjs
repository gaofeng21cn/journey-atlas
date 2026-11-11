// Missing edges are review work, not permission to invent a nearest-base
// round trip. Reviewed changes use the same atomic update path as all edits.
import {parseArgs} from 'node:util';
import {loadAtlas} from './atlas-data.mjs';
import {updateAtlas} from './update-atlas.mjs';

const {values}=parseArgs({options:{input:{type:'string'},vault:{type:'string'},'dry-run':{type:'boolean',default:false}}});
if(values.input){
  await updateAtlas({input:values.input,vault:values.vault,dryRun:values['dry-run'],noRender:true});
}else{
  const {atlas}=await loadAtlas(values.vault);
  const pending=atlas.locationLayer.places.filter(p=>p.access.pending);
  console.log(JSON.stringify({generated:0,note:'只列真实待接入地点；先核对地面活动与同次行程顺序，再提交有依据的前后边。不会自动生成最近城市往返。',pending:pending.map(p=>({id:p.id,name:p.name,country:p.country,first:p.first,last:p.last,evidence:p.evidence,source:p.source,reason:p.access.reason}))},null,2));
}
