import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {setModel,extractOffer} from '../dist/assets/extractor.js';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
setModel(read('../dist/assets/clause_model.json'));
const cases=read('../data/evaluation/adversarial_cases.json').cases;
const base=read('../data/evaluation/extraction_gold.json')[0].text;

// These are post-hoc regression cases used to repair deterministic guards.
// Their success is not an independent real-document accuracy benchmark.
for(const entry of cases)test(`adversarial scope: ${entry.id}`,()=>{
  const result=extractOffer(entry.text);
  assert.equal(result.supported,entry.expected_supported,entry.reason);
  assert.ok(result.issues.length>0);
});

test('monetary suffixes and document-wide scaling do not create false amounts',()=>{
  const scaled=extractOffer(cases.find(c=>c.id==='scaled_both_amounts').text);
  assert.equal(scaled.fields.principal.value,null);
  assert.equal(scaled.fields.upfront_fee.value,null);
  const document=extractOffer(base+'\nAll figures are expressed in thousands of EUR.\n');
  assert.equal(document.supported,false);
  assert.equal(document.fields.principal.value,null);
  assert.equal(document.fields.upfront_fee.value,null);
});

test('bounded and conditional amounts remain unknown',()=>{
  for(const[id,field]of[['conditional_waiver','upfront_fee'],['up_to_principal','principal'],['minimum_fee','upfront_fee']]){
    const result=extractOffer(cases.find(c=>c.id===id).text);
    assert.equal(result.fields[field].value,null);
    assert.equal(result.fields[field].status,'ambiguous');
  }
});

test('explicit monthly compounding is a supported positive control',()=>{
  const result=extractOffer(base.replace('Nominal annual interest rate: 3.50%.','Nominal annual interest rate: 3.50%, compounded monthly.'));
  assert.equal(result.supported,true,JSON.stringify(result.issues));
});

test('an unresolved recognised financial clause cannot silently disappear',()=>{
  const result=extractOffer(base+'\nPrincipal amount: one hundred thousand euros.\n');
  assert.equal(result.supported,false);
  assert.equal(result.fields.principal.value,null);
});
