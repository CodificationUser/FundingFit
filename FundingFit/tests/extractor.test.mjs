import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {setModel,classifyClause,extractOffer} from '../dist/assets/extractor.js';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
setModel(read('../dist/assets/clause_model.json'));
const gold=read('../data/evaluation/extraction_gold.json');
const offer=gold[0].text;

test('browser classifier matches original sklearn predictions',()=>{
  for(const row of read('../models/inference_reference.json')){
    const actual=classifyClause(row.text);
    for(const[label,expected]of Object.entries(row.probabilities))assert.ok(Math.abs(actual.probabilities[label]-expected)<1e-12,`${label} differs`);
  }
});

test('all gold field values, source spans and product boundaries',()=>{
  for(const row of gold){
    const actual=extractOffer(row.text,{id:row.id,name:row.name});
    for(const[field,result]of Object.entries(actual.fields)){
      const expected=field==='other_costs'&&row.expected[field]==='none'?0:row.expected[field];
      assert.equal(result.value,expected,`${row.id} ${field}`);
      if(result.value!==null)assert.equal(row.text.slice(result.span.start,result.span.end),result.source);
    }
    assert.equal(actual.supported,['offer_a','offer_b','offer_c'].includes(row.id));
    assert.equal(actual.requires_user_confirmation,true);
  }
});

test('missing fee stays missing',()=>{
  const actual=extractOffer(gold[3].text);
  assert.equal(actual.fields.upfront_fee.value,null);
  assert.equal(actual.supported,false);
});

test('no insurance alone never establishes no other costs',()=>{
  const actual=extractOffer(offer.replace('Other costs: none.\n',''));
  assert.equal(actual.fields.other_costs.value,null);
  assert.equal(actual.supported,false);
});

test('conflicting rates and mixed currencies block comparison',()=>{
  const actual=extractOffer(offer+'\nNominal annual interest rate: 5.70%.\n');
  assert.equal(actual.fields.annual_rate_pct.status,'ambiguous');
  assert.equal(actual.supported,false);
  assert.equal(extractOffer(offer+'\nSettlement currency: USD.\n').supported,false);
});

test('zero fees, grouped amounts and year conversion',()=>{
  const zero=extractOffer(offer.replace('Upfront arrangement fee: EUR 5000.','The arrangement fee is waived.'));
  assert.equal(zero.fields.upfront_fee.value,0);
  assert.equal(zero.supported,true);
  const grouped=extractOffer(offer.replace('EUR 100000.','EUR 100,000.00.').replace('60 months.','5 years.'));
  assert.equal(grouped.fields.principal.value,100000);
  assert.equal(grouped.fields.term_months.value,60);
  assert.equal(grouped.supported,true);
});

test('extra costs and unknown text are not treated as supported',()=>{
  const extra=extractOffer(offer.replace('Other costs: none.','Other costs: EUR 250.'));
  assert.equal(extra.fields.other_costs.value,250);
  assert.equal(extra.supported,false);
  const unknown=extractOffer('Bright blue clouds over the mountains.\nThe restaurant is open on Tuesdays.');
  assert.equal(unknown.supported,false);
  assert.ok(Object.values(unknown.fields).every(x=>x.value===null));
});

test('an unlabelled rate is not assumed to be annual',()=>{
  const actual=extractOffer(offer.replace('Nominal annual interest rate:','Interest rate:'));
  assert.equal(actual.fields.annual_rate_pct.value,null);
  assert.equal(actual.supported,false);
});

test('negated or conflicting equal repayments are unsupported',()=>{
  const variants=[offer.replace('Repayment: equal monthly instalments, payable at each month-end.','Repayment: not equal monthly instalments, payable at each month-end.'),offer+'\nRepayment is not equal monthly instalments.\n'];
  for(const text of variants){const actual=extractOffer(text);assert.equal(actual.supported,false);assert.equal(actual.repayment_confirmed,false);}
});

test('negation of separate payment cannot hide a financed fee',()=>{
  const actual=extractOffer(offer.replace('Fee payment: paid separately at drawdown; not financed in the loan principal.','Fee payment: not paid separately at drawdown; financed in the loan principal.'));
  assert.equal(actual.supported,false);
  assert.equal(actual.fee_payment_confirmed,false);
  assert.ok(actual.issues.some(x=>x.includes('financed in')));
});
