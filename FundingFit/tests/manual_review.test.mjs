import './helpers/pdfjs_text_environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
import {readPdfDocument} from '../dist/assets/pdf_reader.js';
import {evaluateReview} from '../dist/assets/review.js';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
setModel(JSON.parse(read('dist/assets/clause_model.json')));
const baseline=read('data/offers/offer_a.txt');
const allScope={currency:'EUR',rate_type:'fixed',other_costs:0,repayment_confirmed:true,fee_payment_confirmed:true};
const manual=(item,scope={},corrections={})=>({...item,corrections,review:{scope}});
async function original(name){
  const path='data/layout_examples/original/'+name;
  const pdf=await readPdfDocument(new Uint8Array(readFileSync(new URL(path,root))));
  return extractOffer(pdf.text,{name,layoutLines:pdf.lines,layoutWarnings:pdf.warnings});
}

test('a complete AI proposal needs only the final user check in the interface',()=>{
  const item=extractOffer(baseline),result=evaluateReview(item);
  assert.equal(result.ready,true);assert.deepEqual(result.manualUpdates,[]);
  assert.equal(result.terms.upfront_fee,5000);
});

test('a missed numeric proposal can be entered without an explanation form',()=>{
  const item=extractOffer(baseline.replace('Principal amount: EUR 100000.','Principal amount: one hundred thousand euros.'));
  assert.equal(item.fields.principal.value,null);
  assert.equal(evaluateReview(item).ready,false);
  const result=evaluateReview(manual(item,{}, {principal:100000}));
  assert.equal(result.ready,true);assert.equal(result.terms.principal,100000);
  assert.equal(result.manualUpdates[0].field,'principal');
  assert.equal(item.fields.principal.value,null,'AI proposal is immutable');
});

test('blank, null and non-numeric manual values are not converted to zero',()=>{
  for(const value of ['', ' ',null,undefined,false,NaN,Infinity]){
    const result=evaluateReview(manual(extractOffer(baseline),{}, {upfront_fee:value}));
    assert.equal(result.ready,false,String(value));assert.equal(result.terms.upfront_fee,null,String(value));
  }
  const result=evaluateReview(manual(extractOffer(baseline),{}, {upfront_fee:0}));
  assert.equal(result.ready,true);assert.equal(result.terms.upfront_fee,0);
});

test('manual correction is recorded automatically without note or reference requirements',()=>{
  const item=extractOffer(baseline);
  const result=evaluateReview(manual(item,{}, {upfront_fee:4500}));
  assert.equal(result.ready,true);assert.equal(result.terms.upfront_fee,4500);
  assert.equal(item.fields.upfront_fee.value,5000);
  assert.equal(result.manualUpdates[0].from,5000);
  assert.deepEqual(result.manualUpdates,[{field:'upfront_fee',from:5000,value:4500}]);
});

test('legacy explanation fields do not affect readiness or appear in automatic changes',()=>{
  const item=extractOffer(baseline);
  for(const note of ['', 'x', 'Correct', 'A sufficiently long explanation', null, 123]){
    const result=evaluateReview({...item,corrections:{upfront_fee:4500},review:{scope:{},note,reference:''}});
    assert.equal(result.ready,true,String(note));
    assert.deepEqual(result.manualUpdates,[{field:'upfront_fee',from:5000,value:4500}]);
  }
});

test('original Northbridge PDF progresses only with explicit fee-payment clarification',async()=>{
  const item=await original('Offer_A_Northbridge_letter.pdf');
  assert.equal(item.supported,false);assert.equal(evaluateReview(item).ready,false);
  assert.deepEqual(evaluateReview(item).missingFields,['fee_payment_confirmed']);
  assert.match(evaluateReview(item).fieldErrors.fee_payment_confirmed,/paid separately/);
  const result=evaluateReview(manual(item,{fee_payment_confirmed:true}));
  assert.equal(result.ready,true,result.hardIssues.concat(result.reviewIssues).join('; '));
  assert.equal(result.terms.principal,80000);assert.equal(result.terms.upfront_fee,1200);
  assert.equal(item.fee_payment_confirmed,false);assert.equal(item.supported,false);
});

test('original Kestrel PDF does not imply zero other costs from marketing or after-month-12 wording',async()=>{
  const item=await original('Offer_C_Kestrel_quote.pdf');
  assert.equal(item.fields.other_costs.value,null);
  assert.deepEqual(new Set(evaluateReview(item).missingFields),new Set(['other_costs','fee_payment_confirmed']));
  assert.equal(evaluateReview(manual(item,{fee_payment_confirmed:true})).ready,false);
  const result=evaluateReview(manual(item,{fee_payment_confirmed:true,other_costs:0}));
  assert.equal(result.ready,true,result.hardIssues.concat(result.reviewIssues).join('; '));
  assert.equal(result.terms.other_costs,0);
  assert.equal(result.manualUpdates.find(x=>x.field==='other_costs').from,null);
  assert.equal(item.fields.other_costs.value,null);
});

for(const name of ['Offer_B_AlderVale_termsheet.pdf','Offer_D_Harbourline_contract_VARIABLE.pdf']){
  test(`original ${name} remains blocked despite manual rewrites`,async()=>{
    const item=await original(name),before=JSON.stringify(item);
    const result=evaluateReview(manual(item,allScope,{principal:80000,annual_rate_pct:4.2,term_months:60,upfront_fee:1000}));
    assert.equal(result.ready,false);assert.ok(result.hardIssues.length>0);
    assert.equal(JSON.stringify(item),before);
  });
}

test('the deliberately incomplete fee fixture can be completed without changing its PDF',()=>{
  const item=extractOffer(read('data/offers/offer_incomplete.txt'));
  assert.equal(evaluateReview(item).ready,false);assert.equal(item.fields.upfront_fee.value,null);
  assert.equal(evaluateReview(manual(item,{fee_payment_confirmed:true})).ready,false);
  const result=evaluateReview(manual(item,{fee_payment_confirmed:true},{upfront_fee:650}));
  assert.equal(result.ready,true,result.hardIssues.concat(result.reviewIssues).join('; '));
  assert.equal(result.terms.upfront_fee,650);assert.equal(item.fields.upfront_fee.value,null);
});

test('source-negated equal repayments cannot be overridden by a confirmation',()=>{
  const item=extractOffer(baseline.replace('Repayment: equal monthly instalments, payable at each month-end.','You do not repay the same amount every month.'));
  const result=evaluateReview(manual(item,allScope));
  assert.equal(result.ready,false);assert.ok(result.hardIssues.some(x=>x.includes('not equal monthly')));
});

test('a positive replacement fee cannot inherit a zero-fee payment convention',()=>{
  const source=baseline.replace('Upfront arrangement fee: EUR 5000.','Upfront arrangement fee: EUR 0.').replace('Fee payment: paid separately at drawdown; not financed in the loan principal.','');
  const item=extractOffer(source);assert.equal(item.fee_payment_confirmed,true);
  const result=evaluateReview(manual(item,{}, {upfront_fee:650}));
  assert.equal(result.ready,false);assert.equal(result.terms.fee_payment_confirmed,null);
  assert.equal(evaluateReview(manual(item,{fee_payment_confirmed:true},{upfront_fee:650})).ready,true);
});

test('changing a principal or rate still passes the financial input limits',()=>{
  for(const corrections of [{principal:0},{annual_rate_pct:-1},{term_months:60.5},{upfront_fee:100000},{upfront_fee:-1}]){
    const result=evaluateReview(manual(extractOffer(baseline),{},corrections));
    assert.equal(result.ready,false);
    assert.ok(result.fieldErrors[Object.keys(corrections)[0]],'The invalid value has an inline error.');
  }
});

test('a missing fee has a specific field error and is never silently zero',()=>{
  const item=extractOffer(read('data/offers/offer_incomplete.txt'));
  const result=evaluateReview(item);
  assert.match(result.fieldErrors.upfront_fee,/Enter the upfront fee/);
  assert.ok(result.missingFields.includes('upfront_fee'));
  assert.equal(result.terms.upfront_fee,null);
});

test('an invalid entered value is identified even while a different field remains missing',()=>{
  const item=extractOffer(read('data/offers/offer_incomplete.txt'));
  const result=evaluateReview(manual(item,{}, {annual_rate_pct:-1}));
  assert.match(result.fieldErrors.annual_rate_pct,/between 0% and 50%/);
  assert.match(result.fieldErrors.upfront_fee,/Enter the upfront fee/);
  assert.equal(result.ready,false);
});

test('hard-blocked documents have concise reasons instead of asking for manual explanations',async()=>{
  const variable=evaluateReview(await original('Offer_D_Harbourline_contract_VARIABLE.pdf'));
  assert.match(variable.blockedSummary,/variable or changing rate/);
  const extra=evaluateReview(await original('Offer_B_AlderVale_termsheet.pdf'));
  assert.match(extra.blockedSummary,/additional or unresolved charges/);
  assert.equal(evaluateReview(extractOffer(baseline)).blockedSummary,'');
});

test('manual scope selections never bypass a known unsupported source currency',()=>{
  const item=extractOffer(baseline.replaceAll('EUR','CAD'));
  const result=evaluateReview(manual(item,allScope));
  assert.equal(result.ready,false);assert.ok(result.hardIssues.some(x=>x.includes('currency')));
});

test('unresolved PDF layout warnings remain hard source problems',()=>{
  const item=extractOffer(baseline,{layoutWarnings:['Ambiguous column association.']});
  assert.equal(evaluateReview(manual(item,allScope)).ready,false);
});

const adversarial=JSON.parse(read('data/evaluation/adversarial_cases.json')).cases;
const hardCases=['percentage_guarantee_fee','percentage_account_fee','fee_amount_unknown','fee_conditional','fee_spelled_amount','fixed_introductory','up_to_principal','minimum_fee','conditional_waiver','conflicting_currency','later_variable','negative_amortisation','penalty_mandatory','fee_range','interest_only_no_magic'];
for(const id of hardCases){
  const row=adversarial.find(x=>x.id===id);
  if(!row)throw new Error(`Missing fixture ${id}`);
  test(`manual overrides preserve hard source guard: ${id}`,()=>{
    const item=extractOffer(row.text);
    const result=evaluateReview(manual(item,allScope,{principal:100000,annual_rate_pct:3.5,term_months:60,upfront_fee:5000}));
    assert.equal(result.ready,false);assert.ok(result.hardIssues.length>0,row.id);
  });
}

const safety=JSON.parse(read('data/layout_examples/safety_cases.json'));
for(const row of safety.filter(x=>x.expected_supported===false)){
  test(`manual overrides preserve positioned-clause safety: ${row.id}`,()=>{
    const result=evaluateReview(manual(extractOffer(row.text),allScope,{principal:80000,annual_rate_pct:4.9,term_months:60,upfront_fee:400}));
    assert.equal(result.ready,false);assert.ok(result.hardIssues.length>0,row.id);
  });
}
