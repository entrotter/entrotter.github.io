import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';

// No browser/network needed: exercise the exact production hash/number functions.
const context=vm.createContext({
  document:{getElementById:()=>({value:'not-an-allowed-sample',addEventListener:()=>{}})},
  crypto:webcrypto,TextEncoder,
  fetch:()=>{throw new Error('Unit tests must not contact the network');}
});
vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),context);
const sample=()=>JSON.parse(readFileSync(new URL('../reports/liquidity-shock.json',import.meta.url),'utf8'));
for(const name of ['liquidity-shock','recovery-trap','depeg-stress']){
  test(`production JS verifies Python artifact: ${name}`,async()=>{
    await context.checkHash(JSON.parse(readFileSync(new URL(`../reports/${name}.json`,import.meta.url),'utf8')));
  });
}
test('tampered metric fails integrity validation',async()=>{
  const r=sample();r.candidate.metrics.final_equity='999999';
  await assert.rejects(context.checkHash(r),/mismatch/);
});
test('unknown schema is not accepted',async()=>{
  const r=sample();r.schema_version='9';
  await assert.rejects(context.checkHash(r),/Unsupported/);
});
test('canonical ASCII escaping includes supplementary Unicode',()=>{
  assert.equal(context.canonical({x:'🛸',a:'é'}),'\x7b"a":"\\u00e9","x":"\\ud83d\\udef8"\x7d');
});
test('finite numerical display validation',()=>{
  assert.equal(context.finite('8557.0516'),8557.0516);
  assert.throws(()=>context.finite('Infinity'),/Invalid metric/);
  assert.throws(()=>context.finite(2),/Invalid metric/);
});
test('JS re-canonicalization matches exported content hash',()=>{
  const {artifact_id,...r}=sample();
  assert.equal(createHash('sha256').update(context.canonical(r)).digest('hex'),artifact_id);
});
