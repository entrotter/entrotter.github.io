export function canonical(x) {
  if (Array.isArray(x)) return '['+x.map(canonical).join(',')+']';
  if (x && typeof x==='object') return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
  return JSON.stringify(x);
}
const require=(ok,message)=>{if(!ok)throw new Error(message)};
const integer=x=>typeof x==='string' && /^-?\d{1,78}$/.test(x);
const hash=x=>typeof x==='string' && /^0x[\da-f]{64}$/i.test(x);
export async function validate(envelope) {
  require(envelope && typeof envelope==='object' && !Array.isArray(envelope),'Expected report envelope');
  const r=envelope.report;
  require(r && r.format==='tokyo-compare/1' && r.mode==='archived-state-local-execution','Unsupported report format or mode');
  const bytes=new TextEncoder().encode(canonical(r));
  require(bytes.length<2_000_000,'Report too large');
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  require(actual===envelope.sha256,'Report hash mismatch');
  require(r.source?.chainId===1 && Number.isSafeInteger(r.source.blockNumber) && r.source.blockNumber>0 && hash(r.source.blockHash) && hash(r.source.stateRoot),'Invalid chain / block pin');
  require(r.decimals?.ETH===18 && r.decimals.WETH===18 && r.decimals.USDC===6,'Unsupported decimals');
  require(integer(r.constraints?.amountIn) && BigInt(r.constraints.amountIn)>0n && integer(r.constraints.maxSpend) && BigInt(r.constraints.maxSpend)>0n && integer(r.constraints.minRateUSDCPerWETH) && BigInt(r.constraints.minRateUSDCPerWETH)>0n && Number.isSafeInteger(r.constraints.maxGas) && r.constraints.maxGas>=21000 && r.constraints.maxGas<=500000,'Invalid constraints');
  require(Array.isArray(r.trials) && r.trials.length===4,'Expected four alternatives');
  require(Array.isArray(r.setup) && r.setup.length===2 && r.setup.every(t=>t?.receipt?.status==='0x1'),'Missing successful setup receipts');
  require(r.contracts?.router?.toLowerCase()==='0xe592427a0aece92de3edee1f18e0157c05861564','Unexpected router');
  require(r.nodeCleanedUp===true,'Node cleanup not confirmed');
  const names=['proposed','reduced','strict-minimum','hold'];
  const first=r.trials[0];
  for (let i=0;i<4;i++) {
    const t=r.trials[i];
    require(t.id===names[i] && ['success','revert','hold'].includes(t.status),'Invalid trial identity or status');
    require(hash(t.initialStateRoot) && hash(t.initialBlockHash) && t.initialStateRoot===first.initialStateRoot && t.initialBlockHash===first.initialBlockHash && canonical(t.before)===canonical(first.before) && canonical(t.initialObservation)===canonical(first.initialObservation),'Alternatives have different initial states');
    const fp=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(t.initialObservation))))].map(b=>b.toString(16).padStart(2,'0')).join('');
    require(fp===t.initialStateFingerprint && canonical(t.initialObservation.balances)===canonical(t.before),'Initial observation fingerprint mismatch');
    require(integer(t.amountIn) && BigInt(t.amountIn)>=0n && integer(t.minimumOut) && BigInt(t.minimumOut)>=0n,'Invalid swap amount');
    require(Number.isSafeInteger(t.gasUsed) && t.gasUsed>=0 && t.gasUsed<=500000 && integer(t.gasCostWei),'Invalid gas');
    for(const k of ['ETH','WETH','USDC']) {
      require(integer(t.before?.[k]) && integer(t.after?.[k]) && integer(t.delta?.[k]),'Invalid balance');
      require(BigInt(t.before[k])>=0n && BigInt(t.after[k])>=0n && BigInt(t.after[k])-BigInt(t.before[k])===BigInt(t.delta[k]),'Balance delta mismatch');
    }
    require(BigInt(t.delta.ETH)===-BigInt(t.gasCostWei),'Native fee mismatch');
    if(t.id==='hold') {
      require(t.status==='hold' && t.execution===null && t.gasUsed===0 && t.gasCostWei==='0' && t.amountIn==='0' && Object.values(t.delta).every(v=>v==='0'),'Hold must have no execution or balance change');
    } else {
      const e=t.execution, receipt=e?.receipt;
      require(receipt && hash(receipt.transactionHash) && hash(receipt.blockHash),'Missing receipt');
      require(receipt.status===(t.status==='success'?'0x1':'0x0') && t.status!=='hold','Receipt status mismatch');
      require(/^0x[0-9a-f]+$/i.test(receipt.gasUsed) && /^0x[0-9a-f]+$/i.test(receipt.effectiveGasPrice),'Invalid receipt gas');
      require(BigInt(receipt.gasUsed)===BigInt(t.gasUsed) && BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)===BigInt(t.gasCostWei),'Receipt gas mismatch');
      require(e.transaction?.to?.toLowerCase()===r.contracts.router.toLowerCase() && typeof e.transaction.data==='string' && /^0x[0-9a-f]+$/i.test(e.transaction.data) && e.transaction.data.length===522,'Invalid swap calldata');
      const data=e.transaction.data.toLowerCase();
      require(data.slice(0,10)==='0x414bf389' && BigInt('0x'+data.slice(330,394))===BigInt(t.amountIn) && BigInt('0x'+data.slice(394,458))===BigInt(t.minimumOut),'Swap calldata disagrees with action');
      if(t.status==='revert') require(t.delta.WETH==='0' && t.delta.USDC==='0','Revert changed token balances');
      else require(BigInt(t.delta.WETH)===-BigInt(t.amountIn) && BigInt(t.delta.USDC)>=BigInt(t.minimumOut),'Successful swap violates amounts');
    }
    const proceed=t.status==='success' && BigInt(t.amountIn)<=BigInt(r.constraints.maxSpend) && BigInt(t.delta.USDC)>=BigInt(t.minimumOut) && t.gasUsed<=r.constraints.maxGas;
    require(t.verdict===(proceed?'PROCEED':'HOLD'),'Decision inconsistent with constraints');
    require(typeof t.reason==='string' && t.reason.length<1000,'Invalid decision explanation');
  }
  require(first.amountIn===r.constraints.amountIn && r.trials[2].amountIn===first.amountIn,'Proposed amount mismatch');
  const reduced=BigInt(first.amountIn)/2n<BigInt(r.constraints.maxSpend)?BigInt(first.amountIn)/2n:BigInt(r.constraints.maxSpend);
  require(BigInt(r.trials[1].amountIn)===reduced,'Reduced amount mismatch');
  for(const t of r.trials.slice(0,2)) require(BigInt(t.minimumOut)===BigInt(t.amountIn)*BigInt(r.constraints.minRateUSDCPerWETH)/10n**18n,'Minimum rate mismatch');
  return r;
}
export function decimal(raw,places) {
  const n=BigInt(raw), sign=n<0n?'-':'', a=(n<0n?-n:n).toString().padStart(places+1,'0');
  return sign+a.slice(0,-places)+(a.slice(-places).replace(/0+$/,'')?'.'+a.slice(-places).replace(/0+$/,''):'');
}
