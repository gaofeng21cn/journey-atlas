// CSV parsing is intentionally kept local: source tables are UTF-8 CSV and do
// not need a spreadsheet runtime. The parser handles quoted commas, doubled
// quotes, CRLF and embedded newlines while returning the same string-valued
// rows used by the source schema.
export const parseCsv = text => {
  const input=String(text||'').replace(/^\uFEFF/,'');let row=[],rows=[],field='',quoted=false;
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){if(ch==='"'){if(input[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=ch;continue;}
    if(ch==='"'&&field===''){quoted=true;continue;}
    if(ch===','){row.push(field);field='';continue;}
    if(ch==='\n'||ch==='\r'){if(ch==='\r'&&input[i+1]==='\n')i++;row.push(field);field='';if(row.some(v=>v!==''))rows.push(row);row=[];continue;}
    field+=ch;
  }
  if(field!==''||row.length){row.push(field);if(row.some(v=>v!==''))rows.push(row);}
  const headers=rows.shift()||[];return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
};
export const csv = (rows, headers = Object.keys(rows[0] || {})) => '\uFEFF' + [headers, ...rows.map(r => headers.map(k => r[k] ?? ''))].map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n') + '\n';
