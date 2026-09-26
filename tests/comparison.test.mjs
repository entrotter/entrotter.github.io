import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validate,canonical,decimal} from '../report-validation.mjs';
const original=JSON.parse(readFileSync(new URL('../assets/examples/action-comparison.json',import.meta.url)));
function tamper(fn,rehash=true){const e=structuredClone(original);fn(e.report);if(rehash)e.sha256=createHash('sha256').update(canonical(e.report)).digest('hex');return e}
test('measured report passes hash and semantic validation',async()=>assert.equal((await validate(original)).trials.length,4));
for(const [name,fn,rehash] of [
 ['changed hash',r=>r.trials[0].gasUsed++,false],
 ['receipt gas mismatch',r=>r.trials[0].gasUsed++,true],
 ['different starting root',r=>r.trials[1].initialStateRoot='0x'+'f'.repeat(64),true],
 ['inconsistent delta',r=>r.trials[0].delta.USDC='1',true],
 ['fake hold fee',r=>r.trials[3].gasCostWei='1',true],
 ['wrong chain',r=>r.source.chainId=2,true],
 ['invalid decimals',r=>r.decimals.USDC=18,true],
 ['forged policy',r=>r.trials[0].verdict='PROCEED',true],
 ['wrong input',r=>r.trials[1].amountIn='1',true],
 ['missing receipt',r=>r.trials[0].execution=null,true],
 ['missing cleanup',r=>r.nodeCleanedUp=false,true],
 ['unsupported format',r=>r.format='other',true],
 ['invalid amount type',r=>r.trials[0].amountIn=1e18,true]
]) test('rejects '+name,async()=>assert.rejects(()=>validate(tamper(fn,rehash))));
test('rejects malformed envelope',async()=>assert.rejects(()=>validate(null)));
test('exact decimals avoid floating point',()=>{assert.equal(decimal('741110419',6),'741.110419');assert.equal(decimal('-263476000000000',18),'-0.000263476');assert.equal(decimal('0',6),'0')});
