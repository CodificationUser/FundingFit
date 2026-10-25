// Run the real app's event handlers against a small DOM adapter. Markup is
// parsed for actual controls, so unsupported cards cannot gain fake inputs.
import './helpers/pdfjs_text_environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
import {readPdfDocument} from '../dist/assets/pdf_reader.js';
import {evaluateReview} from '../dist/assets/review.js';
import {compareOffers,calculateLoan} from '../dist/assets/finance.js';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
setModel(JSON.parse(read('dist/assets/clause_model.json')));
const baseline=read('data/offers/offer_a.txt');
function offer(source=baseline,id='a',confirmed=true){
  return {...(typeof source==='string'?extractOffer(source,{id,name:'Offer '+id.toUpperCase()}):source),id,confirmed,confirmed_at:confirmed?'2026-10-25T10:00:00Z':null,corrections:{},review:{scope:{}}};
}
async function original(name,id){
  const pdf=await readPdfDocument(new Uint8Array(readFileSync(new URL('data/layout_examples/original/'+name,root))));
  return offer(extractOffer(pdf.text,{name,layoutLines:pdf.lines,layoutWarnings:pdf.warnings}),id,false);
}
const attr=(s,key)=>s.match(new RegExp('\\b'+key+'="([^"]*)"'))?.[1];
class Element{
  constructor(dataset={}){this.dataset=dataset;this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.open=false;this._html='';this.textContent='';this.events={};this.attributes={};this.classes=new Set();this.classList={toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c),remove:c=>this.classes.delete(c)};}
  set innerHTML(v){this._html=v;}
  get innerHTML(){return this._html;}
  querySelectorAll(){return [];}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  setAttribute(k,v){this.attributes[k]=v;}
  closest(selector){return selector==='.field'?this.field??null:this.card;}
  dispatch(name){for(const fn of [...(this.events[name]||[])])fn({target:this});}
}
class Conditions extends Element{
  constructor(card){super();this.card=card;this.scopes=[];}
  set innerHTML(html){
    this._html=html;this.scopes=[];
    for(const match of html.matchAll(/<select\b([^>]*data-scope="([^"]+)"[^>]*)>([\s\S]*?)<\/select>/g)){
      const e=new Element({offer:attr(match[1],'data-offer'),scope:match[2]});e.card=this.card;
      const options=[...match[3].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)],selected=options.find(m=>/\bselected\b/.test(m[1]))||options[0];e.options=options.map(m=>({value:attr(m[1],'value')??'',label:m[2]}));e.value=attr(selected?.[1]||'','value')??'';this.scopes.push(e);
    }
  }
  get innerHTML(){return this._html;}
  querySelectorAll(s){return s==='[data-scope]'?this.scopes:[];}
}
function cardFromHtml(html){
  const id=attr(html,'data-review-card'),hard=html.includes('data-unavailable="true"'),card=new Element({reviewCard:id});card.innerHTML=html;card.hard=hard;card.nodes=new Map();card.fields=[];card.numeric=new Map();
  card.nodes.set('[data-remove-offer]',new Element({removeOffer:id}));
  if(!hard){
    for(const selector of ['.status-pill','[data-confirm-hint]','[data-global-error]','[data-currency-label]'])card.nodes.set(selector,new Element());
    card.nodes.set('[data-confirm]',new Element({confirm:id}));card.nodes.set('[data-restore]',new Element({restore:id}));
    card.conditions=new Conditions(card);card.nodes.set('.conditions-section',card.conditions);
    for(const match of html.matchAll(/<input\b([^>]*data-field="([^"]+)"[^>]*)>/g)){
      const key=match[2],e=new Element({offer:attr(match[1],'data-offer'),field:key});e.value=attr(match[1],'value')??'';e.card=card;
      const field=new Element(),label=new Element(),error=new Element();field.querySelector=s=>s==='[data-current-label]'?label:error;e.field=field;card.fields.push(e);card.numeric.set(key,field);
    }
  }
  for(const node of card.nodes.values())node.card=card;
  card.querySelector=s=>{
    const key=s.match(/^\[data-numeric-field="([^"]+)"\]$/)?.[1];if(key)return card.numeric.get(key)||null;
    return card.nodes.get(s)||null;
  };
  return card;
}
function harness(items){
  const ids=new Map();let cards=[];
  const review=new Element();Object.defineProperty(review,'innerHTML',{get(){return this._html;},set(html){this._html=html;cards=[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(m=>cardFromHtml(m[0]));}});
  review.querySelectorAll=s=>s==='[data-review-card]'?cards:s==='[data-field]'?cards.flatMap(c=>c.fields):cards.map(c=>c.querySelector(s)).filter(Boolean);ids.set('review-cards',review);
  const get=id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);};get('monthly-limit').value='2000';get('upfront-budget').value='6000';
  const document={getElementById:get,querySelectorAll:()=>[],querySelector:()=>new Element()},window={scrollTo(){}};
  const source=read('dist/assets/app.js').replace(/^import[^\n]+\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('dist/assets/app.js',root).href));
  const body=source.slice(0,source.lastIndexOf("document.querySelectorAll('.step')"));
  const context=vm.createContext({document,window,extractOffer,evaluateReview,compareOffers,calculateLoan,Intl,Date,URL,Blob,console,setTimeout});
  vm.runInContext(body+`\nglobalThis.downloads=[];download=(name,content,type)=>downloads.push({name,content,type});globalThis.app={set(items){analysed=items;documents=items.map(d=>({id:d.id,name:d.name,text:d.text}));},renderReview,renderDocuments,runAnalysis,setModelReady(){ready=true;},canCompare,renderComparison,exportComparison,exportSchedule,renderSchedule,canonical,fieldHtml,hardCardHtml,getOffers(){return analysed;},getComparison(){return comparison;},fakeComparison(){comparison={old:true};}};`,context);
  context.app.set(items);context.app.renderReview();
  return {app:context.app,get,downloads:context.downloads,review,card:i=>cards[i],field:(i,key)=>cards[i].fields.find(e=>e.dataset.field===key),scope:(i,key)=>cards[i].conditions?.scopes.find(e=>e.dataset.scope===key)};
}
function enter(node,value,event='input'){assert.ok(node,'the control exists in the rendered UI');node.value=value;node.dispatch(event);}
function confirm(h,i){const check=h.card(i).querySelector('[data-confirm]');assert.equal(check.disabled,false);check.checked=true;check.dispatch('change');}

test('numbers and all product conditions are editable with actual choices and the AI reading retained',()=>{
  const item=offer(),h=harness([item,offer(read('data/offers/offer_b.txt'),'b')]);
  assert.equal(h.card(0).fields.length,4);assert.match(h.review.innerHTML,/Editable — check these values/);assert.match(h.card(0).conditions.innerHTML,/AI reading: EUR/);
  for(const key of ['currency','rate_type','other_costs','repayment_confirmed','fee_payment_confirmed'])assert.ok(h.scope(0,key).options.length>=3,key+' has unknown and distinct alternatives');
  assert.deepEqual(h.scope(0,'currency').options.map(o=>o.value),['','EUR','USD','GBP','OTHER']);
  assert.doesNotMatch(h.review.innerHTML,/Explain manual|data-review-note|<textarea|clarification reference|at least 10/);
  enter(h.field(0,'upfront_fee'),'');
  assert.equal(item.corrections.upfront_fee,null);assert.equal(h.app.canonical(item).upfront_fee,null);assert.equal(item.fields.upfront_fee.value,5000);
  assert.equal(item.confirmed,false);assert.equal(item.confirmed_at,null);assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);assert.match(h.card(0).querySelector('.status-pill').textContent,/upfront fee/i);
  h.card(0).querySelector('[data-restore]').dispatch('click');
  assert.equal(h.app.canonical(item).upfront_fee,5000);assert.equal(item.confirmed,false);
});

test('a missed amount is entered and confirmed without an explanation form',()=>{
  const item=offer(baseline.replace('Principal amount: EUR 100000.','Principal amount: one hundred thousand euros.'),'a',false),h=harness([item,offer(read('data/offers/offer_b.txt'),'b')]);
  assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);
  enter(h.field(0,'principal'),'100000');assert.equal(evaluateReview(item).ready,true);assert.equal(item.fields.principal.value,null);
  confirm(h,0);assert.equal(item.confirmed,true);assert.equal(h.app.canCompare(),true);
  h.app.renderComparison();assert.equal(h.get('export-btn').disabled,false);
  enter(h.field(0,'annual_rate_pct'),'4.3');
  assert.equal(item.confirmed,false);assert.equal(item.confirmed_at,null);assert.equal(h.get('export-btn').disabled,true);assert.equal(h.app.getComparison(),null);
});

test('the original Northbridge offer highlights its one unresolved condition before editable AI proposals',async()=>{
  const item=await original('Offer_A_Northbridge_letter.pdf','a'),h=harness([item,offer(read('data/offers/offer_b.txt'),'b')]);
  assert.equal(h.card(0).conditions.scopes.length,5);assert.match(h.card(0).querySelector('.status-pill').textContent,/1 condition to confirm/);assert.ok(h.scope(0,'fee_payment_confirmed'));
  assert.equal(h.card(0).conditions.scopes[0].dataset.scope,'fee_payment_confirmed','the needed choice appears before known conditions');
  assert.match(h.card(0).conditions.innerHTML,/AI reading: EUR/);
  enter(h.scope(0,'fee_payment_confirmed'),'true','change');
  assert.equal(evaluateReview(item).ready,true);assert.equal(h.card(0).querySelector('[data-confirm]').disabled,false);assert.match(h.card(0).querySelector('.status-pill').textContent,/Ready to confirm/);
  assert.equal(h.scope(0,'fee_payment_confirmed').events.change.length,1);
  confirm(h,0);assert.equal(h.app.canCompare(),true);
});

test('the original Kestrel offer displays both unresolved conditions directly',async()=>{
  const item=await original('Offer_C_Kestrel_quote.pdf','c'),h=harness([item,offer(read('data/offers/offer_b.txt'),'b')]);
  assert.equal(h.card(0).conditions.scopes.length,5);assert.match(h.card(0).querySelector('.status-pill').textContent,/2 conditions to confirm/);
  enter(h.scope(0,'fee_payment_confirmed'),'true','change');assert.equal(evaluateReview(item).ready,false);
  enter(h.scope(0,'other_costs'),'0','change');assert.equal(evaluateReview(item).ready,true);confirm(h,0);
  assert.equal(h.app.canCompare(),true);assert.equal(item.fields.other_costs.value,null,'original AI proposal is not overwritten');
});

test('a real variable-rate offer is gray, has no edit controls and is automatically left out',()=>{
  const variable=offer(read('data/offers/offer_variable.txt'),'d',false);variable.review.note='Legacy text must not be exported';variable.review.reference='Legacy reference';
  const items=[offer(),offer(read('data/offers/offer_b.txt'),'b'),variable],h=harness(items);
  assert.equal(h.card(2).hard,true);assert.equal(h.card(2).fields.length,0);assert.equal(h.card(2).querySelector('[data-confirm]'),null);assert.equal(h.card(2).querySelector('.conditions-section'),null);
  assert.match(h.card(2).innerHTML,/Cannot compare this offer/);assert.match(h.card(2).innerHTML,/variable/i);assert.doesNotMatch(h.card(2).innerHTML,/<input|<select|data-include/);
  assert.equal(h.app.canCompare(),true);h.app.renderComparison();assert.equal(h.app.getComparison().offers.length,2);h.app.exportComparison();
  const audit=JSON.parse(h.downloads[0].content).review.find(x=>x.id==='d');assert.equal(audit.included_in_comparison,false);assert.equal(audit.source_text,variable.text);assert.ok(audit.review_status.hard_issues.length);
  assert.equal(audit.manual_review,undefined);assert.doesNotMatch(JSON.stringify(audit),/Legacy text|Legacy reference/);
});

test('removing an offer clears the result without resetting the other offers',()=>{
  const a=offer(),b=offer(read('data/offers/offer_b.txt'),'b'),variable=offer(read('data/offers/offer_variable.txt'),'d',false),h=harness([a,b,variable]);
  h.app.renderComparison();assert.ok(h.app.getComparison());
  h.card(2).querySelector('[data-remove-offer]').dispatch('click');
  assert.equal(h.app.getOffers().length,2);assert.equal(a.confirmed,true);assert.equal(b.confirmed,true);assert.equal(h.app.getComparison(),null);assert.equal(h.get('export-btn').disabled,true);assert.equal(h.app.canCompare(),true);assert.equal(h.card(2),undefined);
});

test('changing a zero fee to a positive fee reveals its missing payment condition',()=>{
  const source=baseline.replace('Upfront arrangement fee: EUR 5000.','Upfront arrangement fee: EUR 0.').replace('Fee payment: paid separately at drawdown; not financed in the loan principal.','');
  const item=offer(source),h=harness([item,offer(read('data/offers/offer_b.txt'),'b')]);
  assert.equal(h.scope(0,'fee_payment_confirmed'),undefined);enter(h.field(0,'upfront_fee'),'650');
  assert.equal(evaluateReview(item).ready,false);assert.equal(evaluateReview(item).terms.fee_payment_confirmed,null);assert.equal(h.scope(0,'fee_payment_confirmed').value,'');enter(h.scope(0,'fee_payment_confirmed'),'true','change');
  assert.equal(evaluateReview(item).ready,true);assert.equal(item.confirmed,false);assert.equal(item.confirmed_at,null);
});

test('unsupported-only workspaces state the minimum supported-offer requirement',()=>{
  const h=harness([offer(read('data/offers/offer_variable.txt'),'d',false)]);
  assert.equal(h.app.canCompare(),false);assert.match(h.get('verification-status').textContent,/Add at least two supported offers/);assert.match(h.get('verification-status').textContent,/1 unsupported offer is not included/);
});

test('an invalid budget clears a previous result and disables both exports',()=>{
  const h=harness([offer(),offer(read('data/offers/offer_b.txt'),'b')]);h.app.renderComparison();assert.ok(h.app.getComparison());
  h.get('monthly-limit').value='';h.app.renderComparison();
  assert.equal(h.app.getComparison(),null);assert.equal(h.get('export-btn').disabled,true);assert.equal(h.get('schedule-export').disabled,true);assert.equal(h.get('offer-comparison').innerHTML,'');assert.equal(h.get('schedule-body').innerHTML,'');assert.equal(h.get('comparison-review-note').hidden,true);
});


test('one offer can be analysed on its own while comparison still needs two checked supported offers',async()=>{
  const h=harness([offer(baseline,'a',false)]);h.app.renderDocuments();
  assert.equal(h.get('analyse-btn').disabled,false,'single-offer analysis is available');
  h.app.setModelReady();await h.app.runAnalysis();
  assert.equal(h.app.getOffers().length,1);assert.equal(h.get('analyse-btn').disabled,false);
  confirm(h,0);assert.equal(h.app.getOffers()[0].confirmed,true);
  assert.equal(h.app.canCompare(),false);assert.equal(h.get('compare-btn').disabled,true);
  assert.match(h.get('verification-status').textContent,/at least two supported offers/);
});

test('a missing currency can actually become USD without converting or changing the numbers',()=>{
  const source=baseline.replace(/^Currency: EUR\.\n/m,'').replaceAll('EUR ',''),a=offer(source,'a',false),b=offer(read('data/offers/offer_b.txt').replaceAll('EUR','USD'),'b'),h=harness([a,b]);
  assert.equal(a.fields.currency.value,null);assert.equal(h.scope(0,'currency').value,'');
  assert.match(h.card(0).querySelector('[data-currency-label]').textContent,/no assumed currency/);
  assert.doesNotMatch(h.app.fieldHtml(a,'principal'),/EUR|€/);assert.match(h.app.fieldHtml(a,'principal'),/currency not selected/);
  const amounts=[h.field(0,'principal').value,h.field(0,'upfront_fee').value];
  enter(h.scope(0,'currency'),'USD','change');
  assert.equal(a.review.scope.currency,'USD');assert.equal(h.app.canonical(a).currency,'USD');assert.equal(h.scope(0,'currency').value,'USD');assert.equal(a.fields.currency.value,null);
  assert.deepEqual([h.field(0,'principal').value,h.field(0,'upfront_fee').value],amounts);assert.equal(evaluateReview(a).ready,true);
  confirm(h,0);assert.equal(h.app.canCompare(),true);h.app.renderComparison();
  assert.equal(h.app.getComparison().currency,'USD');assert.match(h.get('offer-comparison').innerHTML,/USD/);assert.doesNotMatch(h.get('offer-comparison').innerHTML,/EUR|€/);
  assert.match(h.get('cost-chart').innerHTML,/USD/);assert.doesNotMatch(h.get('cost-chart').innerHTML,/€/);assert.match(h.get('balance-chart').innerHTML,/Outstanding principal · USD/);
  assert.match(h.get('schedule-body').innerHTML,/USD/);assert.equal(h.get('monthly-unit').textContent,'USD');assert.equal(h.get('upfront-unit').textContent,'USD');
  assert.match(h.get('comparison-currency-note').textContent,/USD/);assert.match(h.get('generous-btn').textContent,/USD/);assert.doesNotMatch(h.get('generous-btn').textContent,/€/);
});

test('known AI conditions stay editable and choosing Unknown stores null instead of silently restoring them',()=>{
  const a=offer(),h=harness([a,offer(read('data/offers/offer_b.txt'),'b')]);h.app.renderComparison();assert.ok(h.app.getComparison());
  enter(h.scope(0,'currency'),'','change');
  assert.ok(Object.hasOwn(a.review.scope,'currency'));assert.equal(a.review.scope.currency,null);assert.equal(evaluateReview(a).terms.currency,null);assert.equal(h.scope(0,'currency').value,'');
  assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);assert.equal(a.confirmed,false);assert.equal(a.confirmed_at,null);assert.equal(h.app.getComparison(),null);assert.equal(h.get('export-btn').disabled,true);assert.equal(h.get('schedule-export').disabled,true);
  assert.equal(a.fields.currency.value,'EUR');assert.match(h.card(0).conditions.innerHTML,/AI reading: EUR/);
  enter(h.scope(0,'currency'),'USD','change');assert.equal(evaluateReview(a).ready,true);assert.equal(evaluateReview(a).terms.currency,'USD');
  enter(h.scope(0,'rate_type'),'','change');assert.equal(a.review.scope.rate_type,null);assert.equal(evaluateReview(a).terms.rate_type,null);assert.equal(h.scope(0,'rate_type').value,'');assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);
  enter(h.scope(0,'rate_type'),'fixed','change');assert.equal(evaluateReview(a).ready,true);assert.equal(a.confirmed,false);
});

test('unsupported manual choices retain their actual values, are excluded, and can be corrected',()=>{
  for(const [key,chosen,stored,restore] of [['currency','OTHER','OTHER','EUR'],['rate_type','variable','variable','fixed'],['other_costs','additional','additional','0'],['repayment_confirmed','false',false,'true'],['fee_payment_confirmed','false',false,'true']]){
    const a=offer(),h=harness([a,offer(read('data/offers/offer_b.txt'),'b'),offer(read('data/offers/offer_c.txt'),'c')]);
    enter(h.scope(0,key),chosen,'change');
    assert.equal(a.review.scope[key],stored,key+' stores the actual chosen type');assert.equal(h.scope(0,key).value,chosen);
    assert.equal(evaluateReview(a).selectionBlocked,true,key);assert.equal(h.card(0).hard,false);assert.equal(h.card(0).classes.has('selection-blocked'),true);assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);
    assert.match(h.card(0).querySelector('[data-confirm-hint]').textContent,/Correct the selection/);assert.equal(h.scope(0,key).disabled,false);assert.equal(h.app.canCompare(),true,'the other checked supported offers can still compare');
    h.app.renderComparison();h.app.exportComparison();const audit=JSON.parse(h.downloads[0].content).review[0];assert.equal(audit.included_in_comparison,false);assert.equal(audit.review_status.selection_blocked,true);assert.equal(audit.verified_terms[key],stored);
    enter(h.scope(0,key),restore,'change');assert.equal(evaluateReview(a).ready,true,key+' can be corrected');assert.equal(evaluateReview(a).selectionBlocked,false);assert.equal(h.card(0).querySelector('[data-confirm]').disabled,false);assert.equal(a.confirmed,false);assert.equal(h.app.getComparison(),null);assert.equal(h.get('export-btn').disabled,true);
  }
});

test('mixed EUR and USD offers stop the UI before any ranking, chart or cash-limit conclusion',()=>{
  const a=offer(),b=offer(read('data/offers/offer_b.txt'),'b'),h=harness([a,b]);h.app.renderComparison();assert.ok(h.app.getComparison());
  enter(h.scope(1,'currency'),'USD','change');confirm(h,1);
  assert.equal(h.app.canCompare(),false);assert.equal(h.get('compare-btn').disabled,true);assert.match(h.get('verification-status').textContent,/different currencies/);assert.match(h.get('verification-status').textContent,/no currency conversion/);
  h.app.renderComparison();assert.equal(h.app.getComparison(),null);assert.equal(h.get('offer-comparison').innerHTML,'');assert.equal(h.get('cost-chart').innerHTML,'');assert.equal(h.get('balance-chart').innerHTML,'');assert.equal(h.get('schedule-body').innerHTML,'');assert.equal(h.get('export-btn').disabled,true);assert.equal(h.get('schedule-export').disabled,true);assert.match(h.get('notice').textContent,/different currencies/);
  assert.equal(h.get('monthly-unit').textContent,'—');assert.equal(h.get('upfront-unit').textContent,'—');h.app.exportComparison();h.app.exportSchedule();assert.equal(h.downloads.length,0);
});

test('GBP comparisons, limits and both exports use GBP consistently and never euro',()=>{
  const a=offer(baseline.replaceAll('EUR','GBP')),b=offer(read('data/offers/offer_b.txt').replaceAll('EUR','GBP'),'b'),h=harness([a,b]);
  assert.equal(h.app.canCompare(),true);h.app.renderComparison();
  assert.equal(h.get('monthly-unit').textContent,'GBP');assert.equal(h.get('upfront-unit').textContent,'GBP');
  for(const id of ['offer-comparison','cost-chart','schedule-body']){assert.match(h.get(id).innerHTML,/GBP/);assert.doesNotMatch(h.get(id).innerHTML,/EUR|€/);}
  assert.match(h.app.fieldHtml(a,'principal'),/GBP/);assert.doesNotMatch(h.app.fieldHtml(a,'principal'),/EUR|€/);
  h.app.exportComparison();h.app.exportSchedule();assert.equal(h.downloads.length,2);
  const audit=JSON.parse(h.downloads[0].content);assert.equal(audit.version,'2.4.0');assert.equal(audit.currency,'GBP');assert.equal(audit.limits.currency,'GBP');assert.equal(audit.comparison.currency,'GBP');assert.ok(audit.comparison.offers.every(o=>o.currency==='GBP'));assert.ok(audit.review.every(o=>o.verified_terms.currency==='GBP'));
  const csv=h.downloads[1].content;assert.match(csv,/^currency,month,opening,interest,principal,payment,closing\r\n"GBP","1"/);assert.doesNotMatch(csv,/EUR|€/);
});

test('zero fees show payment as not applicable and preserve earlier choices when a fee returns',()=>{
  const a=offer(),h=harness([a,offer(read('data/offers/offer_b.txt'),'b')]);
  enter(h.scope(0,'fee_payment_confirmed'),'false','change');assert.equal(evaluateReview(a).selectionBlocked,true);
  enter(h.field(0,'upfront_fee'),'0');assert.equal(a.review.scope.fee_payment_confirmed,false);assert.equal(h.scope(0,'fee_payment_confirmed'),undefined);assert.match(h.card(0).conditions.innerHTML,/Not applicable — no upfront fee/);assert.equal(evaluateReview(a).ready,true);
  enter(h.field(0,'upfront_fee'),'100');assert.equal(h.scope(0,'fee_payment_confirmed').value,'false');assert.equal(evaluateReview(a).selectionBlocked,true);assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);
  enter(h.scope(0,'fee_payment_confirmed'),'true','change');assert.equal(evaluateReview(a).ready,true);
});

test('an explicitly unsupported source currency is identified as unsupported rather than missing',()=>{
  const a=offer(baseline.replaceAll('EUR','CAD'),'a',false),h=harness([a]);
  assert.equal(h.card(0).hard,true);const terms=h.card(0).innerHTML.match(/<dl[\s\S]*?<\/dl>/)[0];assert.match(terms,/CAD \(not supported\)/);assert.doesNotMatch(terms,/currency not selected|EUR|€/);
  assert.equal(h.app.canCompare(),false);assert.equal(h.card(0).querySelector('[data-confirm]'),null);
});

test('absent repayment and fee-payment evidence prefill Unknown while an explicit unsupported choice stays reversible',()=>{
  const source=baseline.replace(/^Repayment:.*\n/m,'').replace(/^Fee payment:.*\n/m,''),a=offer(source,'a',false),h=harness([a,offer(read('data/offers/offer_b.txt'),'b')]);
  assert.equal(a.repayment_confirmed,false,'raw extraction only records lack of positive confirmation');assert.equal(a.fee_payment_confirmed,false);
  assert.equal(h.card(0).hard,false);assert.equal(evaluateReview(a).selectionBlocked,false);assert.equal(h.card(0).classes.has('selection-blocked'),false);assert.match(h.card(0).querySelector('.status-pill').textContent,/2 conditions to confirm/);
  for(const key of ['repayment_confirmed','fee_payment_confirmed']){
    assert.equal(evaluateReview(a).terms[key],null);assert.equal(h.scope(0,key).value,'','absence of evidence selects Unknown');
    enter(h.scope(0,key),'false','change');assert.equal(a.review.scope[key],false);assert.equal(h.scope(0,key).value,'false');assert.equal(evaluateReview(a).selectionBlocked,true);assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);
    enter(h.scope(0,key),'','change');assert.equal(a.review.scope[key],null);assert.equal(h.scope(0,key).value,'');assert.equal(evaluateReview(a).selectionBlocked,false,'returning to Unknown removes the unsupported choice');assert.equal(h.scope(0,key).disabled,false);
  }
  assert.equal((h.card(0).conditions.innerHTML.match(/AI reading: Not found/g)||[]).length,2,'the original absent evidence is labelled missing, not unsupported');
  enter(h.scope(0,'repayment_confirmed'),'true','change');assert.equal(evaluateReview(a).ready,false);
  enter(h.scope(0,'fee_payment_confirmed'),'true','change');assert.equal(evaluateReview(a).ready,true);confirm(h,0);assert.equal(h.app.canCompare(),true);
  h.card(0).querySelector('[data-restore]').dispatch('click');assert.equal(h.scope(0,'repayment_confirmed').value,'');assert.equal(h.scope(0,'fee_payment_confirmed').value,'');assert.equal(a.confirmed,false);assert.equal(evaluateReview(a).selectionBlocked,false);assert.equal(h.card(0).querySelector('[data-confirm]').disabled,true);
});
