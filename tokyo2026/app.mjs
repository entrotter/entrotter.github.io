import {validate,decimal} from './report.mjs';
const $=id=>document.getElementById(id);
const titles={'proposed':'Proposed swap','reduced':'Reduce the size','strict-minimum':'Raise the minimum','hold':'Keep the position'};
let current;
function el(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n}
async function display(envelope,label){
  // Clear stale evidence before validating a new import.
  $('results').hidden=true;$('download').disabled=true;current=null;
  const r=await validate(envelope);current=envelope;
  $('mode').textContent=label;$('source-summary').textContent=`Ethereum block ${r.source.blockNumber.toLocaleString()} · WETH → USDC · 0.30% pool · Local Anvil execution`;
  $('message').textContent='';$('constraints').replaceChildren(...[
    `Spend cap: ${decimal(r.constraints.maxSpend,18)} WETH`,
    `Minimum rate: ${decimal(r.constraints.minRateUSDCPerWETH,6)} USDC / WETH`,
    `Gas cap: ${r.constraints.maxGas.toLocaleString()} units`,
    'Setup funding + approval excluded from trial gas'
  ].map(s=>el('span',s)));
  $('cards').replaceChildren();
  for (const [i,t] of r.trials.entries()) {
    const card=el('article','','card'+(t.verdict==='PROCEED'?' recommended':''));
    const top=el('div','','card-top');top.append(el('span',`0${i+1} / ${t.id==='hold'?'NO TRANSACTION':'LOCAL TRIAL'}`),el('span',t.status,'status '+t.status));card.append(top,el('h3',titles[t.id]));
    const amount=el('div',decimal(t.delta.USDC,6),'amount');amount.append(el('small','USDC'));card.append(amount,el('div','Actual token balance change','label'));
    const dl=el('dl','');for(const [label,value] of [['WETH change',decimal(t.delta.WETH,18)+' WETH'],['Gas used',t.gasUsed.toLocaleString()+' units'],['Native gas cost',decimal(t.gasCostWei,18)+' ETH'],['Minimum output',decimal(t.minimumOut,6)+' USDC']]){const row=el('div','');row.append(el('dt',label),el('dd',value));dl.append(row)}
    card.append(dl,el('div',t.verdict==='PROCEED'?'WITHIN YOUR CONSTRAINTS':'HOLD / DO NOT PROCEED','verdict'),el('p',t.reason,'reason'));
    const d=el('details','');d.append(el('summary',t.execution?'Inspect receipt & exact balances':'Inspect zero-change evidence'),el('pre',JSON.stringify({initialStateFingerprint:t.initialStateFingerprint,initialObservation:t.initialObservation,before:t.before,after:t.after,delta:t.delta,execution:t.execution},null,2)));card.append(d);$('cards').append(card);
  }
  const good=r.trials.filter(t=>t.verdict==='PROCEED');
  $('takeaway').textContent=good.length?`${good.map(t=>titles[t.id]).join(' and ')} meets the supplied constraints in this recorded run. Success alone is not permission: check the spending cap, minimum output and gas together. Holding spends no execution gas.`:'None of the tested swaps meets every constraint. Holding leaves balances unchanged and spends no execution gas.';
  $('pins').textContent=JSON.stringify({source:r.source,contracts:r.contracts,decimals:r.decimals,overrides:r.overrides,tools:r.tools,sha256:envelope.sha256,nodeCleanedUp:r.nodeCleanedUp,limitations:r.limitations},null,2);
  $('setup').textContent=JSON.stringify(r.setup,null,2);$('results').hidden=false;$('download').disabled=false;
}
function error(e){$('results').hidden=true;$('download').disabled=true;current=null;$('mode').textContent='Report rejected';$('message').textContent='Could not load report: '+e.message}
async function sample(){try{const response=await fetch('./example.json');if(!response.ok)throw Error('Example unavailable');await display(await response.json(),'Recorded example · executed September 26, 2026')}catch(e){error(e)}}
$('sample').onclick=sample;
$('report-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw Error('Maximum report size is 2 MB');await display(JSON.parse(await file.text()),'Imported local report · validated in your browser')}catch(e){error(e)}finally{e.target.value=''}};
$('download').onclick=()=>{if(!current)return;const u=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));const a=el('a','');a.href=u;a.download='tokyo-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
$('command-form').onsubmit=e=>{e.preventDefault();const values=['amount','spend','rate'].map(id=>$(id).value);if(values.some(v=>!/^\d{1,6}(\.\d{1,6})?$/.test(v)||Number(v)<=0)){ $('command').textContent='Enter positive decimal amounts (up to six decimal places).';return; }$('command').textContent=`python3 compare.py --amount ${values[0]} --max-spend ${values[1]} --min-rate ${values[2]} --output report.json`;};
sample();
