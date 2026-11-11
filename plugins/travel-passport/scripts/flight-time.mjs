// Ticket clocks constrain order, not a claim of actual airborne time.
export function localEpoch(date,time,zone){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{1,2}:\d{2}$/.test(time||'')||!zone)return null;
  const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);
  const target=Date.UTC(y,m-1,d,h,min);let utc=target;
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){const parts=Object.fromEntries(fmt.formatToParts(utc).map(p=>[p.type,p.value]));const local=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute);utc+=target-local;}
  return utc/1000;
}
