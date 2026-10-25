import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
setModel(JSON.parse(readFileSync(new URL('../dist/assets/clause_model.json',import.meta.url))));
const source=JSON.parse(readFileSync(new URL('../data/evaluation/extraction_gold.json',import.meta.url)))[0].text;
const repayment='Repayment: equal monthly instalments, payable at each month-end.';
test('an explicit same amount every month describes equal monthly repayments',()=>{
 const result=extractOffer(source.replace(repayment,'You repay the same amount every month.'));
 assert.equal(result.supported,true);assert.equal(result.repayment_confirmed,true);
});
test('negation of the same monthly amount cannot confirm equal repayments',()=>{
 const result=extractOffer(source.replace(repayment,'You do not repay the same amount every month.'));
 assert.equal(result.supported,false);assert.equal(result.repayment_confirmed,false);
});
test('unresolved PDF layout warnings prevent confirmation despite otherwise valid terms',()=>{
 const result=extractOffer(source,{layoutWarnings:['An ambiguous column association needs review.']});
 assert.equal(result.supported,false);assert.ok(result.issues.some(x=>x.includes('PDF layout review required')));
});
