import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
import {evaluateReview} from '../dist/assets/review.js';
import {calculateLoan,compareOffers,LoanValidationError} from '../dist/assets/finance.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
setModel(JSON.parse(read('dist/assets/clause_model.json')));
const baseline=read('data/offers/offer_a.txt');
const extracted=currency=>extractOffer(baseline.replaceAll('EUR',currency));
const manual=(item,scope,corrections={})=>({...item,corrections,review:{scope}});
const input=(currency,changes={})=>({id:'A',name:'Test offer',currency,principal:100000,
  annual_rate_pct:3.5,term_months:60,upfront_fee:5000,...changes});
const allScope={currency:'EUR',rate_type:'fixed',other_costs:0,repayment_confirmed:true,fee_payment_confirmed:true};

for(const currency of ['EUR','USD','GBP']){
  test(`trained extraction, human review and calculation support ${currency}`,()=>{
    const item=extracted(currency),review=evaluateReview(item);
    assert.equal(item.fields.currency.value,currency);
    assert.equal(item.fields.currency.status,'extracted');
    assert.equal(item.supported,true,item.issues.join('; '));
    assert.equal(review.ready,true,review.reviewIssues.concat(review.hardIssues).join('; '));
    assert.equal(review.selectionBlocked,false);
    const result=calculateLoan(review.terms);
    assert.equal(result.currency,currency);
    assert.deepEqual([result.principal,result.upfront_fee,result.monthly_payment,result.total_cost],
      [100000,5000,1819.17,14150.53]);
    assert.equal(result.schedule.at(-1).closing,0);
  });
}

test('a missing currency can be completed with either USD or GBP without explanation forms',()=>{
  const item=extractOffer(baseline.replace(/^Currency:.*\n/m,'').replaceAll('EUR ',''));
  assert.equal(item.fields.currency.value,null);
  assert.equal(evaluateReview(item).ready,false);
  for(const currency of ['USD','GBP']){
    const result=evaluateReview(manual(item,{currency}));
    assert.equal(result.ready,true,result.hardIssues.concat(result.reviewIssues).join('; '));
    assert.equal(result.terms.currency,currency);
    assert.deepEqual(result.manualUpdates,[{field:'currency',from:null,value:currency}]);
  }
  assert.equal(item.fields.currency.value,null,'The original AI proposal remains unchanged.');
});

test('a single supported source currency can be corrected without converting monetary values',()=>{
  const item=extracted('EUR'),review=evaluateReview(manual(item,{currency:'USD'}));
  assert.equal(review.ready,true);
  assert.equal(review.terms.currency,'USD');
  assert.equal(review.terms.principal,100000);
  assert.equal(item.fields.currency.value,'EUR');
  assert.deepEqual(review.manualUpdates,[{field:'currency',from:'EUR',value:'USD'}]);
  assert.deepEqual(calculateLoan(review.terms).schedule,calculateLoan(evaluateReview(item).terms).schedule);
});

test('clearing a known choice stays unknown instead of restoring the AI proposal',()=>{
  for(const key of ['currency','rate_type','other_costs','repayment_confirmed','fee_payment_confirmed']){
    const item=extracted('EUR'),result=evaluateReview(manual(item,{[key]:null}));
    assert.equal(result.terms[key],null,key);
    assert.equal(result.ready,false,key);
    assert.equal(result.selectionBlocked,false,key);
    assert.ok(result.fieldErrors[key],key);
    assert.equal(result.hardIssues.length,0,key);
    assert.equal(evaluateReview(manual(item,{[key]:''})).terms[key],null,key);
  }
});

test('absent repayment or fee-payment evidence stays unknown rather than asserting an unsupported structure',()=>{
  for(const [field,clause] of [
    ['repayment_confirmed','Repayment: equal monthly instalments, payable at each month-end.'],
    ['fee_payment_confirmed','Fee payment: paid separately at drawdown; not financed in the loan principal.'],
  ]){
    const item=extractOffer(baseline.replace(clause,'')),result=evaluateReview(item);
    assert.equal(item[field],false,'The extraction flag indicates a lack of positive evidence.');
    assert.equal(result.terms[field],null,'The review dropdown must present an unknown value.');
    assert.equal(result.ready,false);
    assert.equal(result.selectionBlocked,false);
    assert.equal(result.hardIssues.length,0);
    assert.ok(result.missingFields.includes(field));
    assert.ok(result.fieldErrors[field]);
    const explicitFalse=evaluateReview(manual(item,{[field]:false}));
    assert.equal(explicitFalse.terms[field],false,'An affirmative manual unsupported choice stays distinct from unknown.');
    assert.equal(explicitFalse.selectionBlocked,true);
    assert.ok(explicitFalse.unsupportedSelections[field]);
    assert.equal(evaluateReview(manual(item,{[field]:true})).ready,true);
  }
});

test('a positive replacement fee needs a new payment convention rather than implying a negative one',()=>{
  const item=extractOffer(baseline.replace('Upfront arrangement fee: EUR 5000.','Upfront arrangement fee: EUR 0.')
    .replace('Fee payment: paid separately at drawdown; not financed in the loan principal.',''));
  const result=evaluateReview(manual(item,{}, {upfront_fee:650}));
  assert.equal(item.fee_payment_confirmed,true);
  assert.equal(result.terms.fee_payment_confirmed,null);
  assert.equal(result.selectionBlocked,false);
  assert.equal(result.ready,false);
  assert.ok(result.missingFields.includes('fee_payment_confirmed'));
  assert.equal(evaluateReview(manual(item,{fee_payment_confirmed:true},{upfront_fee:650})).ready,true);
});

for(const [field,value,replacement] of [
  ['currency','OTHER','GBP'],['rate_type','variable','fixed'],
  ['other_costs','additional',0],['repayment_confirmed',false,true],
  ['fee_payment_confirmed',false,true],
]){
  test(`unsupported manual ${field} choice is explicit and reversible`,()=>{
    const item=extracted('EUR'),before=JSON.stringify(item);
    const result=evaluateReview(manual(item,{[field]:value}));
    assert.equal(result.terms[field],value,'The actual choice is retained.');
    assert.equal(result.ready,false);
    assert.equal(result.selectionBlocked,true);
    assert.equal(result.hardIssues.length,0,'A manual choice is not a permanent source block.');
    assert.ok(result.unsupportedSelections[field]);
    assert.ok(result.fieldErrors[field]);
    const corrected=evaluateReview(manual(item,{[field]:replacement}));
    assert.equal(corrected.selectionBlocked,false);
    assert.equal(corrected.ready,true,corrected.reviewIssues.join('; '));
    assert.deepEqual(corrected.unsupportedSelections,{});
    assert.equal(JSON.stringify(item),before,'The original source proposal stays unchanged.');
  });
}

test('an explicit false fee-payment choice is retained but not required when the fee is zero',()=>{
  const item=extracted('EUR');
  const result=evaluateReview(manual(item,{fee_payment_confirmed:false},{upfront_fee:0}));
  assert.equal(result.terms.fee_payment_confirmed,false);
  assert.equal(result.ready,true);
  assert.equal(result.selectionBlocked,false);
  assert.deepEqual(result.unsupportedSelections,{});
});

test('source variable rates and multiple source currencies cannot be cleared by manual choices',()=>{
  const sources=[baseline.replace('fixed for the entire loan','variable for the entire loan'),
    baseline+'\nSettlement currency: USD.\n'];
  for(const source of sources){
    const result=evaluateReview(manual(extractOffer(source),allScope));
    assert.equal(result.ready,false);
    assert.ok(result.hardIssues.length>0);
    assert.equal(result.selectionBlocked,false,'Supported manual choices do not hide the source block.');
  }
});

test('an ambiguous dollar sign needs a currency choice; explicit US dollars are USD',()=>{
  const dollars=baseline.replace(/^Currency:.*\n/m,'').replaceAll('EUR ','$');
  const item=extractOffer(dollars);
  assert.equal(item.fields.currency.value,null);
  assert.equal(evaluateReview(item).ready,false);
  assert.equal(evaluateReview(manual(item,{currency:'USD'})).ready,true);
  const explicit=extractOffer(dollars+'\nCurrency: US dollars.\n');
  assert.equal(explicit.fields.currency.value,'USD');
  assert.equal(evaluateReview(explicit).ready,true);
});

test('Canadian and other unsupported currencies never become USD because of a dollar sign',()=>{
  for(const currency of ['CAD','AUD','NZD','CHF','JPY','CNY','INR','SEK','XYZ']){
    const item=extractOffer(baseline.replaceAll('EUR',currency)+(currency==='CAD'?'\nPrincipal currency notation: CAD$.\n':''));
    assert.equal(item.fields.currency.value,currency,currency);
    assert.equal(item.fields.currency.status,'unsupported',currency);
    assert.equal(evaluateReview(manual(item,allScope)).ready,false,currency);
    assert.ok(evaluateReview(item).hardIssues.length>0,currency);
  }
  const inconsistent=extractOffer(baseline.replace('EUR 5000','$5000'));
  assert.equal(evaluateReview(manual(inconsistent,allScope)).ready,false);
  assert.ok(evaluateReview(inconsistent).hardIssues.some(issue=>/currency|currencies/i.test(issue)));
});

test('financial arithmetic preserves units and makes no currency conversion',()=>{
  const euro=calculateLoan(input('EUR'));
  for(const currency of ['USD','GBP']){
    const result=calculateLoan(input(currency));
    assert.equal(result.currency,currency);
    assert.equal(result.principal,100000);
    assert.equal(result.total_cost,euro.total_cost);
    assert.deepEqual(result.schedule,euro.schedule);
  }
  assert.equal(calculateLoan(input(' usd ')).currency,'USD');
  assert.equal(calculateLoan(input(undefined)).currency,'EUR','Legacy inputs with omitted currency remain EUR.');
  for(const currency of [null,'','CAD','OTHER',123,false]){
    assert.throws(()=>calculateLoan(input(currency)),LoanValidationError,String(currency));
  }
});

for(const currency of ['USD','GBP']){
  test(`same-currency ${currency} offers use matching cash limits and have a valid winner`,()=>{
    const result=compareOffers([input(currency),input(currency,{id:'B',annual_rate_pct:4.2,upfront_fee:500}),
      input(currency,{id:'C',annual_rate_pct:3.9,upfront_fee:1500})],{monthlyLimit:1840,upfrontBudget:2000});
    assert.equal(result.comparable,true);
    assert.equal(result.currency,currency);
    assert.deepEqual(result.currencies,[currency]);
    assert.equal(result.mixedCurrency,false);
    assert.equal(result.limits.currency,currency);
    assert.equal(result.cheapest_overall.id,'B');
    assert.equal(result.cheapest_feasible.id,'C');
    assert.deepEqual(result.offers.map(row=>[row.id,row.cost_rank,row.feasible]),
      [['B',1,false],['C',2,true],['A',3,false]]);
  });
}

test('mixed-currency offers never share rankings, winners, budget feasibility or numeric conversions',()=>{
  const inputs=[input('EUR',{id:'EUR',upfront_fee:10000}),input('USD',{id:'USD',upfront_fee:0})];
  const result=compareOffers(inputs,{monthlyLimit:100000,upfrontBudget:100000});
  assert.equal(result.comparable,false);
  assert.equal(result.currency,null);
  assert.deepEqual(result.currencies,['EUR','USD']);
  assert.equal(result.mixedCurrency,true);
  assert.equal(result.limits.currency,null);
  assert.equal(result.cheapest_overall,null);
  assert.equal(result.cheapest_feasible,null);
  assert.deepEqual(result.offers.map(row=>row.id),['EUR','USD'],'No misleading cheaper-first ordering.');
  for(const row of result.offers){
    assert.equal(row.cost_rank,null);
    assert.equal(row.monthly_feasible,null);
    assert.equal(row.upfront_feasible,null);
    assert.equal(row.feasible,null);
    assert.equal(row.principal,100000);
    assert.ok(row.issues.some(issue=>/different currencies/.test(issue)));
  }
  assert.ok(result.issues.some(issue=>/no currency conversion/.test(issue)));
});
