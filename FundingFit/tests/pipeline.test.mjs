import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
import {compareOffers,calculateLoan} from '../dist/assets/finance.js';
const root=new URL('../',import.meta.url);
setModel(JSON.parse(readFileSync(new URL('dist/assets/clause_model.json',root),'utf8')));
const data=JSON.parse(readFileSync(new URL('data/evaluation/extraction_gold.json',root),'utf8'));
const complete=data.slice(0,3).map(item=>{
  const result=extractOffer(item.text,{id:item.id,name:item.name});
  assert.equal(result.supported,true);
  return {id:item.id,name:item.name,...Object.fromEntries(Object.entries(result.fields).map(([k,v])=>[k,v.value]))};
});
test('actual trained inference feeds the cost engine and both budget decisions',()=>{
  const tight=compareOffers(complete,{monthlyLimit:1840,upfrontBudget:2000});
  assert.equal(tight.cheapest_overall.id,'offer_b');
  assert.equal(tight.cheapest_feasible.id,'offer_c');
  const generous=compareOffers(complete,{monthlyLimit:2000,upfrontBudget:6000});
  assert.equal(generous.cheapest_feasible.id,'offer_b');
});
test('a changed source amount is extracted afresh rather than looked up',()=>{
  const fresh=extractOffer(data[0].text.replace('EUR 100000','EUR 80000'),{id:'new'});
  assert.equal(fresh.fields.principal.value,80000);
  assert.equal(calculateLoan(Object.fromEntries(Object.entries(fresh.fields).map(([k,v])=>[k,v.value]))).principal,80000);
});
test('all source spans refer to the original text',()=>{
  for(const item of data){const result=extractOffer(item.text);for(const f of Object.values(result.fields)){if(f.source)assert.equal(item.text.slice(f.span.start,f.span.end),f.source);}}
});
test('negative cases stay incomplete or unsupported; no silent zero fee',()=>{
  const missing=extractOffer(data.find(d=>d.id==='offer_incomplete').text);
  assert.equal(missing.fields.upfront_fee.value,null);assert.equal(missing.supported,false);
  const variable=extractOffer(data.find(d=>d.id==='offer_variable').text);
  assert.equal(variable.supported,false);assert.equal(variable.fields.rate_type.value,'variable');
});
