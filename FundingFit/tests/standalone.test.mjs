/* Tests the generated artifact's real core and PDF engine. This is a Node VM
 * check, not a claim that a file:// browser UI was exercised. The DOMMatrix
 * sentinel is the same text-only environment used by modular PDF tests. */
import './helpers/pdfjs_text_environment.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const json=path=>JSON.parse(read(path).toString());
const html=read('FundingFit.html').toString();
const data=id=>{
  const match=html.match(new RegExp(`<script type="application/json" id="fundingfit-${id}">([\\s\\S]*?)<\\/script>`));
  assert.ok(match,`Embedded ${id} is present`);
  return JSON.parse(match[1]);
};
const script=html.match(/<script id="fundingfit-bundle" type="module">([\s\S]*?)<\/script>/);
assert.ok(script,'The standalone program is embedded');
let networkAttempts=0,workerConstructions=0;
const context=vm.createContext({
  console,DOMMatrix,navigator:{platform:'MacIntel',userAgent:'Version/26.0 Safari'},URL,TextDecoder,TextEncoder,Uint8Array,Uint16Array,Uint32Array,
  Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,
  structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,performance,
  Blob,ReadableStream,TransformStream,AbortController,AbortSignal,DOMException,
  Worker:class{constructor(){workerConstructions++;throw new Error('External workers are disabled in this test.');}},
  fetch(){networkAttempts++;throw new Error('Network access is disabled in the standalone artifact test.');},
});
// Only dead modular fallback URLs are substituted so a classic VM can parse
// the module prefix. The actual page still uses its unmodified module script.
const core=script[1].split('// FUNDINGFIT_APP_START')[0].replaceAll('import.meta.url','"file:///FundingFit.html"');
new vm.Script(core+'\nglobalThis.__artifact={extractor:__FF_EXTRACTOR,finance:__FF_FINANCE,reader:__FF_READER,review:__FF_REVIEW};').runInContext(context);
const artifact=context.__artifact;
artifact.extractor.setModel(data('model'));

test('standalone build is reproducible from the supplied source files',()=>{
  const directory=mkdtempSync(join(tmpdir(),'fundingfit-build-'));
  try{
    const target=join(directory,'FundingFit.html');
    execFileSync(process.execPath,[fileURLToPath(new URL('scripts/build_standalone.mjs',root)),'--output',target],{stdio:'pipe'});
    assert.equal(readFileSync(target).toString(),html);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('embedded model, examples and metrics match the reproducible modular source',()=>{
  assert.deepEqual(data('model'),json('dist/assets/clause_model.json'));
  assert.deepEqual(data('samples'),json('dist/data/samples.json'));
  assert.deepEqual(data('metrics'),json('dist/data/model_metrics.json'));
  assert.match(html,/connect-src 'none'/);
  assert.match(html,/worker-src 'none'/);
  assert.match(html,/object-src 'none'/);
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html,/<link\b[^>]*rel=["']stylesheet["'][^>]*href=/i);
});

test('actual bundled AI and finance retain the known field values and cash-limit decisions',()=>{
  const gold=json('data/evaluation/extraction_gold.json');
  const offers=[];
  for(const row of gold){
    const result=artifact.extractor.extractOffer(row.text,{id:row.id,name:row.name});
    for(const[key,field]of Object.entries(result.fields)){const value=row.expected[key];assert.equal(field.value,key==='other_costs'&&value==='none'?0:value,`${row.id} ${key}`);}
    assert.equal(result.supported,['offer_a','offer_b','offer_c'].includes(row.id));
    assert.equal(result.requires_user_confirmation,true);
    if(result.supported)offers.push({id:row.id,name:row.name,...Object.fromEntries(Object.entries(result.fields).map(([k,f])=>[k,f.value]))});
  }
  const tight=artifact.finance.compareOffers(offers,{monthlyLimit:1840,upfrontBudget:2000});
  assert.equal(tight.cheapest_overall.id,'offer_b');
  assert.equal(tight.cheapest_feasible.id,'offer_c');
  assert.equal(tight.cheapest_feasible.total_cost,11728.58);
  assert.equal(artifact.finance.compareOffers(offers,{monthlyLimit:2000,upfrontBudget:6000}).cheapest_feasible.id,'offer_b');
});

test('bundled human review completes an absent fee without an explanation form or rewriting the AI proposal',()=>{
  const row=json('data/evaluation/extraction_gold.json').find(x=>x.id==='offer_incomplete');
  const proposal=artifact.extractor.extractOffer(row.text);
  assert.equal(artifact.review.evaluateReview(proposal).ready,false);
  const completed={...proposal,corrections:{upfront_fee:650},review:{scope:{fee_payment_confirmed:true}}};
  const result=artifact.review.evaluateReview(completed);
  assert.equal(result.ready,true,result.hardIssues.concat(result.reviewIssues).join('; '));
  assert.equal(result.terms.upfront_fee,650);
  assert.equal(proposal.fields.upfront_fee.value,null);
  assert.equal(result.manualUpdates.length,2);
  assert.equal('note' in result.manualUpdates[0],false);
  assert.equal('reference' in result.manualUpdates[0],false);
  completed.corrections.upfront_fee=null;
  assert.equal(artifact.review.evaluateReview(completed).ready,false);
});

test('bundled human review cannot override a real variable-rate source',()=>{
  const row=json('data/evaluation/extraction_gold.json').find(x=>x.id==='offer_variable');
  const proposal=artifact.extractor.extractOffer(row.text);
  const edited={...proposal,corrections:{principal:100000,annual_rate_pct:4,term_months:60,upfront_fee:500},review:{scope:{rate_type:'fixed',currency:'EUR',other_costs:0,repayment_confirmed:true,fee_payment_confirmed:true}}};
  const result=artifact.review.evaluateReview(edited);
  assert.equal(result.ready,false);
  assert.ok(result.hardIssues.length>0);
});

test('bundled USD and GBP offers retain their units and never form a cross-currency ranking',()=>{
  const rows=json('data/evaluation/extraction_gold.json').filter(row=>['offer_a','offer_b'].includes(row.id));
  for(const currency of ['USD','GBP']){
    const offers=rows.map(row=>{
      const proposal=artifact.extractor.extractOffer(row.text.replaceAll('EUR',currency),{id:row.id,name:row.name});
      assert.equal(proposal.fields.currency.value,currency);
      const review=artifact.review.evaluateReview(proposal);
      assert.equal(review.ready,true,review.hardIssues.concat(review.reviewIssues).join('; '));
      return review.terms;
    });
    const comparison=artifact.finance.compareOffers(offers,{monthlyLimit:2000,upfrontBudget:6000});
    assert.equal(comparison.currency,currency);
    assert.equal(comparison.cheapest_overall.id,'offer_b');
    assert.equal(comparison.cheapest_overall.total_cost,11541.48);
    const mixed=artifact.finance.compareOffers([offers[0],{...offers[1],currency:'EUR'}],{monthlyLimit:2000,upfrontBudget:6000});
    assert.equal(mixed.comparable,false);assert.equal(mixed.cheapest_overall,null);
    assert.equal(mixed.cheapest_feasible,null);assert.equal(mixed.currency,null);
    for(const offer of mixed.offers){assert.equal(offer.cost_rank,null);assert.notEqual(offer.monthly_feasible,true);assert.notEqual(offer.upfront_feasible,true);}
  }
});

test('bundled choices preserve unknown and unsupported answers instead of forcing allowed values',()=>{
  const row=json('data/evaluation/extraction_gold.json').find(x=>x.id==='offer_a');
  const proposal=artifact.extractor.extractOffer(row.text);
  const unknown=artifact.review.evaluateReview({...proposal,review:{scope:{currency:null}}});
  assert.equal(unknown.terms.currency,null);assert.equal(unknown.ready,false);
  for(const [field,value]of [['rate_type','variable'],['other_costs','additional'],['repayment_confirmed',false],['fee_payment_confirmed',false]]){
    const rejected=artifact.review.evaluateReview({...proposal,review:{scope:{[field]:value}}});
    assert.equal(rejected.terms[field],value);assert.equal(rejected.ready,false);
    assert.equal(rejected.selectionBlocked,true);assert.equal(rejected.hardIssues.length,0);
  }
});

for(const row of json('data/layout_examples/expected_cases.json')){
  test(`actual standalone PDF engine and model: ${row.id}`,async()=>{
    const pdf=await artifact.reader.readPdfDocument(new Uint8Array(read('data/layout_examples/'+row.pdf)));
    const result=artifact.extractor.extractOffer(pdf.text,{id:row.id,layoutLines:pdf.lines,layoutWarnings:pdf.warnings});
    for(const[key,value]of Object.entries(row.expected_fields))assert.equal(result.fields[key].value,value,`${row.id} ${key}`);
    assert.equal(result.supported,row.expected_supported,`${row.id}: ${result.issues.join('; ')}`);
    assert.equal(result.requires_user_confirmation,true);
    for(const f of Object.values(result.fields)){
      if(f.source&&f.span)assert.equal(pdf.text.slice(f.span.start,f.span.end),f.source);
      for(const segment of f.segments||[]){assert.equal(pdf.text.slice(segment.start,segment.end),segment.text);assert.ok(segment.page>=1);}
    }
  });
}

after(()=>{
  assert.equal(networkAttempts,0,'The bundled model, numeric comparison and PDF imports made no network requests');
  assert.equal(workerConstructions,0,'The bundled PDF engine did not create an external worker');
});
