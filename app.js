'use strict';
const $ = (id) => document.getElementById(id);
const allowedSamples = new Set(['liquidity-shock', 'recovery-trap', 'depeg-stress']);
let generation = 0;
// The backend canonicalizes JSON with sorted keys and ensure_ascii=True.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => canonical(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value).replace(/[\u0080-\uffff]/g, c => '\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
async function checkHash(report) {
  if (report.schema_version !== '0.1.0' || !/^[a-f0-9]{64}$/.test(report.artifact_id ?? '')) throw new Error('Unsupported schema or missing hash.');
  const {artifact_id, ...body} = report;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(body)));
  const actual = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
  if (actual !== artifact_id) throw new Error('Content hash mismatch. The result was changed or damaged.');
}
function finite(value) {
  if (typeof value !== 'string' || value.length > 100 || !Number.isFinite(Number(value))) throw new Error('Invalid metric.');
  return Number(value);
}
function fmt(value, digits=2) { return finite(value).toLocaleString('en-US', {maximumFractionDigits:digits}); }
function setError(message) {
  $('report-status').textContent=message; $('report-status').classList.add('error');
  ['baseline-value','candidate-value','delta-value','hash'].forEach(id=>$(id).textContent='—');
  $('baseline-line').setAttribute('points',''); $('candidate-line').setAttribute('points','');
  $('metric-rows').replaceChildren(); $('assumptions').replaceChildren(); $('raw-report').textContent='';
  $('download').hidden=true;
}
async function render(report, seq) {
  await checkHash(report);
  if (seq !== generation) return;
  if (report.mode !== 'fixture') throw new Error('This explorer currently renders fixture reports only. Use the CLI to inspect EVM artifacts.');
  if (report.scenario?.provenance?.kind !== 'synthetic') throw new Error('A fixture must be labelled synthetic.');
  const b=report.baseline, c=report.candidate;
  if (!Array.isArray(b?.trace) || !Array.isArray(c?.trace) || b.trace.length!==c.trace.length || b.trace.length<2 || b.trace.length>4096) throw new Error('Invalid trace.');
  const yb=b.trace.map(x=>finite(x.equity)), yc=c.trace.map(x=>finite(x.equity));
  const values=[...yb,...yc], min=Math.min(...values), max=Math.max(...values), spread=max-min||1;
  function line(ys) {return ys.map((y,i)=>`${45+i/(ys.length-1)*925},${210-(y-min)/spread*165}`).join(' ');}
  $('baseline-line').setAttribute('points',line(yb)); $('candidate-line').setAttribute('points',line(yc));
  $('baseline-value').textContent=fmt(b.metrics.final_equity);
  $('candidate-value').textContent=fmt(c.metrics.final_equity);
  const delta=finite(report.comparison.final_equity_delta);
  $('delta-value').textContent=(delta>0?'+':'')+fmt(report.comparison.final_equity_delta);
  $('metric-rows').replaceChildren();
  for (const [label, key, suffix] of [['Model return','return_pct','%'],['Maximum drawdown','max_drawdown_pct','%'],['Fees (quote units)','fees',''],['Number of trades','trades','']]) {
    const tr=document.createElement('tr');
    for (const text of [label, key==='trades'?String(b.metrics[key]):fmt(b.metrics[key])+suffix, key==='trades'?String(c.metrics[key]):fmt(c.metrics[key])+suffix]) {
      const td=document.createElement('td'); td.textContent=text; tr.appendChild(td);
    }
    $('metric-rows').appendChild(tr);
  }
  if (!Array.isArray(report.assumptions) || report.assumptions.length>32) throw new Error('Invalid assumptions.');
  $('assumptions').replaceChildren();
  for (const text of report.assumptions) {
    if(typeof text!=='string' || text.length>4000) throw new Error('Invalid assumption.');
    const li=document.createElement('li');li.textContent=text;$('assumptions').appendChild(li);
  }
  $('hash').textContent=report.artifact_id;
  $('raw-report').textContent=JSON.stringify(report,null,2);
  $('report-status').classList.remove('error');
  $('report-status').textContent='Integrity verified locally · Synthetic fixture · '+String(report.scenario.title).slice(0,120);
  $('download').hidden=false;
}
async function loadSample() {
  const seq=++generation, name=$('scenario').value;
  if (!allowedSamples.has(name)) return;
  try {
    const response=await fetch('reports/'+name+'.json');
    if (!response.ok) throw new Error('The recorded sample could not be loaded.');
    const text=await response.text(); if(text.length>4*1024*1024) throw new Error('Report too large.');
    await render(JSON.parse(text),seq);
    if(seq===generation) $('download').href='reports/'+name+'.json';
  } catch(error) {if(seq===generation) setError(error.message || 'Could not load this report.');}
}
$('scenario').addEventListener('change',loadSample);
$('import').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;const seq=++generation;
  try{
    if(file.size>4*1024*1024)throw new Error('Local report limit is 4 MiB.');
    await render(JSON.parse(await file.text()),seq);
    // No blob links or network upload are needed for an already-local file.
    if(seq===generation)$('download').hidden=true;
  }catch(error){if(seq===generation)setError(error.message||'Invalid report file.');}
});
loadSample();
