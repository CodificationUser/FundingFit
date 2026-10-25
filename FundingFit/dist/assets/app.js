import {readPdfDocument} from './pdf_reader.js';
import {loadModel, extractOffer} from './extractor.js';
import {compareOffers, calculateLoan} from './finance.js';
import {evaluateReview} from './review.js';

const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const supportedCurrencies=['EUR','USD','GBP'];
function formatMoney(value,currency,digits=2){
  if(!supportedCurrencies.includes(currency))return new Intl.NumberFormat('en-IE',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value)+(currency&&currency!=='OTHER'?` ${currency} (not supported)`:currency==='OTHER'?' (currency not supported)':' (currency not selected)');
  return new Intl.NumberFormat('en-IE',{style:'currency',currency,currencyDisplay:'code',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
}
const money=(value,currency)=>formatMoney(value,currency,2);
const integerMoney=(value,currency)=>formatMoney(value,currency,0);
const pct=v=>`${Number(v).toFixed(2)}%`;
let documents=[], analysed=[], comparison=null, currentStep='intake', previousStep='intake', ready=false, busy=false, evaluation=null;
const fieldNames={principal:'Loan amount',annual_rate_pct:'Nominal annual interest rate · %',term_months:'Repayment term · months',upfront_fee:'Upfront fees',currency:'Currency',rate_type:'Interest type',other_costs:'Other costs'};
const numericFields=['principal','annual_rate_pct','term_months','upfront_fee'];
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=!message;}
function showStep(step){
  if(step==='review'&&!analysed.length){notice('Add your offers and run AI analysis first.');return;}
  if(step==='compare'&&!canCompare()){notice(comparisonProblem());return;}
  currentStep=step;
  document.querySelector('.page-heading').hidden=step!=='intake';
  ['intake','review','compare','help'].forEach(s=>$(s+'-panel').hidden=s!==step);
  document.querySelectorAll('.step').forEach(b=>b.classList.toggle('active',b.dataset.step===step));
  if(step==='compare')renderComparison();
  if(step!=='intake')window.scrollTo({top:0,behavior:'smooth'});
}
function invalidate(){analysed=[];clearComparison();$('review-count').textContent='';$('compare-btn').disabled=true;}
function renderDocuments(){
  $('document-list').innerHTML=documents.map((d,i)=>`<div class="doc-row"><span class="doc-icon">${escape(d.kind||'TXT')}</span><div><strong>${escape(d.name)}</strong><br><small>${d.text.length.toLocaleString()} characters · ${d.synthetic?'Fictional case study':'Local document'}</small></div><button class="remove" data-remove="${i}" aria-label="Remove ${escape(d.name)}">×</button></div>`).join('');
  $('analyse-btn').disabled=documents.length<1||busy;
  $('document-list').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{documents.splice(Number(b.dataset.remove),1);invalidate();renderDocuments();});
}
async function initModel(){if(ready)return;await loadModel(new URL('./clause_model.json',import.meta.url).href);ready=true;$('model-status').textContent='Trained clause classifier ready · Runs locally · No API key';}
async function runAnalysis(){
  if(busy||documents.length<1)return;
  busy=true;renderDocuments();$('analyse-btn').textContent='Reading the offer clauses…';notice('Loading the local model and identifying the loan conditions…');
  try{await initModel();await new Promise(r=>setTimeout(r,30));analysed=documents.map(d=>({...extractOffer(d.text,{id:d.id,name:d.name,layoutLines:d.layoutLines,layoutWarnings:d.layoutWarnings}),confirmed:false,confirmed_at:null,corrections:{},review:{scope:{}},synthetic:!!d.synthetic}));$('review-count').textContent=String(analysed.length);renderReview();showStep('review');notice('AI proposals are ready. Check the sources, complete missing terms when you have evidence, then confirm the offers you want to compare.');}
  catch(err){notice(`Analysis could not run: ${err.message}. Please reload the page or use the local launch instructions.`,true);}
  finally{busy=false;$('analyse-btn').innerHTML='Analyse with AI <span>→</span>';renderDocuments();}
}
async function addFiles(files){
  notice('');let added=0;
  for(const file of files){
    if(documents.length>=5){notice('The workspace supports up to five offers. Remove one to add another.',true);break;}
    if(file.size>2*1024*1024){notice(`${file.name} is larger than the 2 MB limit.`,true);continue;}
    try{
      let text='',kind='TXT',layout=null;
      if(file.name.toLowerCase().endsWith('.pdf')){
        kind='PDF';layout=await readPdfDocument(await file.arrayBuffer());text=layout.text;
      }else if(file.name.toLowerCase().endsWith('.txt'))text=await file.text();
      else throw new Error('Use TXT or a text-based PDF.');
      if(text.trim().length<30)throw new Error('No usable text was found. A scanned PDF needs text extraction first.');
      if(text.length>30000)throw new Error('Use an excerpt of fewer than 30,000 characters.');
      documents.push({id:`upload-${Date.now()}-${added}`,name:file.name.replace(/\.(txt|pdf)$/i,'').slice(0,70),text,kind,layoutLines:layout?.lines||[],layoutWarnings:layout?.warnings||[],pageCount:layout?.pageCount||null});added++;
    }catch(err){notice(`${file.name}: ${err.message}`,true);}
  }
  if(added){invalidate();renderDocuments();}
  $('file-input').value='';
}
function reviewData(item){item.corrections??={};item.review??={scope:{}};item.review.scope??={};return item.review;}
function proposalValue(key,value,currency=null){
  if(value===null||value===undefined)return 'Not found';
  if(key==='principal'||key==='upfront_fee')return money(value,currency);
  if(key==='annual_rate_pct')return `${Number(value)}%`;
  if(key==='term_months')return `${value} months`;
  if(key==='rate_type')return value==='fixed'?'Fixed for the whole loan':value==='variable'?'Variable rate':String(value);
  if(key==='other_costs')return value===0||value==='none'?'No other charges':value==='additional'?'Additional or conditional charges':String(value);
  return String(value);
}
const scopeLabels={currency:'Currency',rate_type:'Interest type',other_costs:'Other costs',repayment_confirmed:'Repayment structure',fee_payment_confirmed:'Upfront fee payment'};
const scopeChoices={
  currency:[['EUR','EUR — euro'],['USD','USD — US dollar'],['GBP','GBP — pound sterling'],['OTHER','Other currency — not supported']],
  rate_type:[['fixed','Fixed for the whole loan'],['variable','Variable or changing rate — not supported']],
  other_costs:[[0,'No other charges'],['additional','Additional or conditional charges — not supported']],
  repayment_confirmed:[[true,'Equal monthly repayments of principal and interest'],[false,'Another repayment structure — not supported']],
  fee_payment_confirmed:[[true,'Paid separately from the loan'],[false,'Financed in or deducted from the loan — not supported']],
};
function errorsFor(result){return result.fieldErrors||{};}
function sourceExcerpt(item,key){
  const f=item.fields[key];
  if(!f?.source)return '';
  return `<blockquote>${escape(f.source)}${f.page?` <span>(page ${f.page}, extracted line ${f.line})</span>`:f.line?` <span>(line ${f.line})</span>`:''}</blockquote>`;
}
function fieldHtml(item,key,result=evaluateReview(item)){
  const f=item.fields[key]||{value:null},corrected=Object.hasOwn(item.corrections||{},key),value=corrected?item.corrections[key]:f.value;
  const error=errorsFor(result)[key]||'';
  return `<div class="field editable-field ${error?'needs-entry':''}" data-numeric-field="${key}"><label for="${escape(item.id)}-${key}">${fieldNames[key]} <span class="editable-label">Editable</span></label><div class="field-top"><input id="${escape(item.id)}-${key}" type="number" step="${key==='term_months'?'1':'0.01'}" min="0" data-offer="${escape(item.id)}" data-field="${key}" value="${value??''}" aria-label="${fieldNames[key]} for ${escape(item.name)}" aria-describedby="${escape(item.id)}-${key}-error" placeholder="Enter the value from the offer"><span class="model-score" data-current-label>${corrected?'Your correction':'AI proposal'}</span></div><p id="${escape(item.id)}-${key}-error" class="field-error" data-error="${key}" ${error?'':'hidden'}>${escape(error)}</p><p class="proposal-original">AI proposal: ${escape(proposalValue(key,f.value,item.fields.currency?.value))}</p>${sourceExcerpt(item,key)}</div>`;
}
function baseCondition(item,key){return evaluateReview({...item,review:{scope:{}}}).terms[key];}
function conditionDescription(key,value){
  if(value===null||value===undefined||value==='')return 'Not found';
  return scopeChoices[key].find(([candidate])=>candidate===value)?.[1]||String(value);
}
function conditionHtml(item,key,result){
  if(key==='fee_payment_confirmed'&&result.terms.upfront_fee===0)return '<div class="condition-item not-applicable"><span class="condition-title">Upfront fee payment</span><strong>Not applicable — no upfront fee</strong></div>';
  const scope=reviewData(item).scope,manual=Object.hasOwn(scope,key),value=result.terms[key],error=errorsFor(result)[key]||'';
  const options=[['','Unknown / not stated'],...scopeChoices[key]];
  const original=baseCondition(item,key);
  return `<div class="condition-item ${error?'needs-entry':''}"><label for="${escape(item.id)}-${key}">${scopeLabels[key]} <span class="editable-label">Editable</span></label><select id="${escape(item.id)}-${key}" data-scope="${key}" data-offer="${escape(item.id)}" aria-label="${scopeLabels[key]} for ${escape(item.name)}" aria-describedby="${escape(item.id)}-${key}-error">${options.map(([candidate,label])=>`<option value="${escape(candidate)}" ${(value==null&&candidate===''||candidate===value)?'selected':''}>${escape(label)}</option>`).join('')}</select><p id="${escape(item.id)}-${key}-error" class="field-error" data-error="${key}" ${error?'':'hidden'}>${escape(error)}</p><span class="condition-origin">${manual?'Your selection':'AI proposal'} · AI reading: ${escape(conditionDescription(key,original))}</span>${key==='currency'?'<p class="condition-help">Choosing a currency sets the unit. Amounts are not converted.</p>':''}${sourceExcerpt(item,key)}</div>`;
}
function conditionsHtml(item,result){
  const keys=['currency','rate_type','other_costs','repayment_confirmed','fee_payment_confirmed'];
  const missing=keys.filter(key=>errorsFor(result)[key]),remaining=keys.filter(key=>!missing.includes(key));
  return `<h4>${missing.length?'Complete or correct the highlighted conditions':'Product conditions — check the AI proposals'}</h4><p class="condition-help">Every list has explicit choices. Unknown means the information still needs checking. Options marked not supported cannot be calculated.</p><div class="condition-grid">${[...missing,...remaining].map(key=>conditionHtml(item,key,result)).join('')}</div>`;
}
function hardCardHtml(item,result){
  return `<article class="review-card unavailable" data-review-card="${escape(item.id)}" data-unavailable="true"><header class="review-header"><h3>${escape(item.name)}</h3><button class="text-btn remove-offer" data-remove-offer="${escape(item.id)}" aria-label="Remove ${escape(item.name)}">Remove offer</button></header><div class="unavailable-body"><span class="status-pill unavailable-pill">Cannot compare this offer</span><p>${escape(result.blockedSummary||'This offer contains terms the calculator cannot handle.')}</p><p class="muted">Not included in the comparison. Remove it or add another supported offer.</p><details class="source-details"><summary>View the source and AI reading</summary><dl class="read-only-terms">${Object.keys(fieldNames).map(key=>`<div><dt>${fieldNames[key]}</dt><dd>${escape(proposalValue(key,item.fields[key]?.value,item.fields.currency?.value))}</dd></div>`).join('')}</dl><pre>${escape(item.text)}</pre></details></div></article>`;
}
function includedOffers(){return analysed.filter(d=>{const result=evaluateReview(d);return !result.hardIssues.length&&!result.selectionBlocked;});}
function isSupported(item){return evaluateReview(item).ready;}
function comparisonCurrencies(){return [...new Set(includedOffers().map(d=>evaluateReview(d).terms.currency).filter(code=>supportedCurrencies.includes(code)))];}
function comparisonCurrency(){const codes=comparisonCurrencies();return codes.length===1?codes[0]:null;}
function comparisonProblem(){
  const included=includedOffers(),codes=comparisonCurrencies();
  if(included.length<2)return 'Add at least two supported offers to compare.';
  if(codes.length>1)return `These offers use different currencies (${codes.join(', ')}). Compare offers in the same currency; no currency conversion is performed.`;
  if(!included.every(d=>d.confirmed&&isSupported(d)))return 'Complete and check each supported offer before comparing.';
  return '';
}
function canCompare(){return comparisonProblem()==='';}
function updateCurrencyLabels(){
  const currency=comparisonCurrency(),label=currency||'—';
  $('monthly-unit').textContent=label;$('upfront-unit').textContent=label;
  $('generous-btn').textContent=currency?`Allow ${integerMoney(2000,currency)}/month and ${integerMoney(6000,currency)} upfront`:'Set limits to 2,000/month and 6,000 upfront';
}
function clearComparison(){
  comparison=null;
  for(const id of ['decision-summary','offer-comparison','cost-chart','balance-chart','schedule-body','comparison-review-note'])$(id).innerHTML='';
  $('export-btn').disabled=true;$('schedule-export').disabled=true;$('comparison-review-note').hidden=true;$('comparison-currency-note').textContent='';
}
function clearConfirmation(item){item.confirmed=false;item.confirmed_at=null;clearComparison();}
function statusText(item,result){
  if(result.selectionBlocked)return 'Not compared — unsupported selection';
  if(item.confirmed)return 'Verified';
  if(result.ready)return 'Ready to confirm';
  if(errorsFor(result).calculation)return 'Check the loan terms';
  const keys=Object.keys(errorsFor(result));
  if(keys.length&&keys.every(k=>!numericFields.includes(k)))return `${keys.length} condition${keys.length===1?'':'s'} to confirm`;
  if(keys.length===1){const labels={principal:'Check loan amount',annual_rate_pct:'Check annual interest rate',term_months:'Check repayment term',upfront_fee:'Check upfront fee'};return labels[keys[0]]||'Check the highlighted condition';}
  return keys.length?`${keys.length} items to check`:'Check the loan terms';
}
function refreshVerification(){
  const included=includedOffers(),verified=included.filter(d=>d.confirmed&&isSupported(d)).length,blocked=analysed.length-included.length;
  const codes=comparisonCurrencies();
  $('verification-status').textContent=codes.length>1?comparisonProblem():included.length<2?`Add at least two supported offers to compare. ${blocked?`${blocked} unsupported offer${blocked===1?' is':'s are'} not included.`:''}`:`${verified} of ${included.length} supported offers checked. ${blocked?`${blocked} unsupported offer${blocked===1?' is':'s are'} not included.`:''}`;
  $('compare-btn').disabled=!canCompare();updateCurrencyLabels();
}
function parseScopeChoice(key,value){
  if(value==='')return null;
  if(key==='other_costs')return value==='0'?0:value;
  if(key==='repayment_confirmed'||key==='fee_payment_confirmed')return value==='true'?true:value==='false'?false:null;
  return value;
}
function bindConditionControls(item,card){
  card.querySelector('.conditions-section').querySelectorAll('[data-scope]').forEach(input=>{
    if(input.reviewBound)return;input.reviewBound=true;
    input.addEventListener('change',()=>{
      const scope=reviewData(item).scope,key=input.dataset.scope;
      scope[key]=parseScopeChoice(key,input.value);
      clearConfirmation(item);refreshReviewCard(item,card);
    });
  });
}
function refreshReviewCard(item,card){
  const result=evaluateReview(item);
  if(result.hardIssues.length){refreshVerification();return;}
  card.classList.toggle('confirmed',!!item.confirmed);card.classList.toggle('selection-blocked',!!result.selectionBlocked);
  const pill=card.querySelector('.status-pill');pill.className='status-pill'+(item.confirmed?' good':!result.ready?' pending-pill':'');pill.textContent=statusText(item,result);
  const check=card.querySelector('[data-confirm]');check.checked=!!item.confirmed;check.disabled=!result.ready;
  const hint=card.querySelector('[data-confirm-hint]');hint.textContent=result.selectionBlocked?'Not included while an unsupported option is selected. Correct the selection or remove this offer.':result.ready?'Check the offer, then tick the box.':'Complete the highlighted fields or conditions above to enable this checkbox.';
  const unit=card.querySelector('[data-currency-label]');if(unit)unit.textContent=supportedCurrencies.includes(result.terms.currency)?`Amounts in ${result.terms.currency}; no currency conversion.`:'Select the currency below. Amounts have no assumed currency.';
  card.querySelector('[data-restore]').hidden=!Object.keys(item.corrections||{}).length&&!Object.keys(reviewData(item).scope).length;
  for(const key of numericFields){const field=card.querySelector(`[data-numeric-field="${key}"]`),message=errorsFor(result)[key]||'';field.classList.toggle('needs-entry',!!message);const error=field.querySelector('[data-error]');error.textContent=message;error.hidden=!message;}
  const globalError=card.querySelector('[data-global-error]');globalError.textContent=result.selectionBlocked?'This offer is not included in the comparison while an unsupported option is selected. You can change the selection.':errorsFor(result).calculation||'';globalError.hidden=!globalError.textContent;
  const conditions=card.querySelector('.conditions-section');conditions.innerHTML=conditionsHtml(item,result);bindConditionControls(item,card);
  refreshVerification();
}
function removeReviewOffer(id){
  documents=documents.filter(d=>d.id!==id);analysed=analysed.filter(d=>d.id!==id);clearComparison();$('review-count').textContent=String(analysed.length||'');renderDocuments();renderReview();
  if(!analysed.length)showStep('intake');
  notice('Offer removed from this workspace. The original file on your device is unchanged.');
}
function renderReview(){
  $('review-cards').innerHTML=analysed.map(d=>{
    const result=evaluateReview(d);reviewData(d);
    if(result.hardIssues.length)return hardCardHtml(d,result);
    return `<article class="review-card" data-review-card="${escape(d.id)}"><header class="review-header"><h3>${escape(d.name)}</h3><div class="review-header-actions"><span class="status-pill"></span><button class="text-btn remove-offer" data-remove-offer="${escape(d.id)}" aria-label="Remove ${escape(d.name)}">Remove offer</button></div></header><div class="review-subheading"><h4>Loan terms</h4><span>Editable — check these values against the offer</span></div><p class="review-currency-label" data-currency-label></p><div class="field-grid">${numericFields.map(k=>fieldHtml(d,k,result)).join('')}</div><div class="manual-toolbar"><button class="text-btn" data-restore="${escape(d.id)}" hidden>Restore AI proposals</button></div><p class="field-error review-global-error" data-global-error hidden></p><section class="conditions-section">${conditionsHtml(d,result)}</section><details class="source-details"><summary>Read the extracted offer text</summary><pre>${escape(d.text)}</pre></details><div class="review-bottom"><div><label><input type="checkbox" data-confirm="${escape(d.id)}"> I checked these values and conditions against the offer.</label><p class="confirm-hint" data-confirm-hint></p></div><span class="muted">${d.synthetic?'Fictional example':'Local document'}</span></div></article>`;
  }).join('');
  const itemFor=input=>analysed.find(d=>d.id===input.dataset.offer);
  $('review-cards').querySelectorAll('[data-field]').forEach(input=>input.addEventListener('input',()=>{
    const item=itemFor(input),key=input.dataset.field,value=input.value.trim()===''?null:Number(input.value);
    if(value!==null&&item.fields[key]?.status==='extracted'&&value===item.fields[key]?.value)delete item.corrections[key];else item.corrections[key]=value;
    clearConfirmation(item);input.closest('.field').querySelector('[data-current-label]').textContent=Object.hasOwn(item.corrections,key)?'Your correction':'AI proposal';refreshReviewCard(item,input.closest('.review-card'));
  }));
  $('review-cards').querySelectorAll('[data-confirm]').forEach(input=>input.addEventListener('change',()=>{
    const item=analysed.find(d=>d.id===input.dataset.confirm);item.confirmed=input.checked&&evaluateReview(item).ready;item.confirmed_at=item.confirmed?new Date().toISOString():null;clearComparison();refreshReviewCard(item,input.closest('.review-card'));
  }));
  $('review-cards').querySelectorAll('[data-remove-offer]').forEach(button=>button.addEventListener('click',()=>removeReviewOffer(button.dataset.removeOffer)));
  $('review-cards').querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',()=>{
    const item=analysed.find(d=>d.id===button.dataset.restore);item.corrections={};item.review={scope:{}};clearConfirmation(item);renderReview();
  }));
  $('review-cards').querySelectorAll('[data-review-card]').forEach(card=>{const item=analysed.find(d=>d.id===card.dataset.reviewCard);if(item)refreshReviewCard(item,card);});
  refreshVerification();
}
function canonical(item){return {...evaluateReview(item).terms,id:item.id,name:item.name};}
function getLimits(){if(!$('monthly-limit').value.trim()||!$('upfront-budget').value.trim())throw new Error('Enter both cash limits. Enter zero only when the available amount is zero.');return {monthlyLimit:Number($('monthly-limit').value),upfrontBudget:Number($('upfront-budget').value)};}
function renderComparison(){
  try{
    const limits=getLimits();if(!Number.isFinite(limits.monthlyLimit)||limits.monthlyLimit<0||!Number.isFinite(limits.upfrontBudget)||limits.upfrontBudget<0)throw new Error('Cash limits must be zero or positive numbers.');
    if(!canCompare())throw new Error(comparisonProblem());
    comparison=compareOffers(includedOffers().map(canonical),limits);
    if(!comparison.comparable)throw new Error('Use matching loan amounts, terms and currencies. No currency conversion is performed.');
    const currency=comparison.currency||comparisonCurrency();updateCurrencyLabels();$('comparison-currency-note').textContent=`All amounts and cash limits are in ${currency}. No currency conversion is performed.`;
    $('export-btn').disabled=false;$('schedule-export').disabled=false;
    const manualCount=includedOffers().filter(d=>evaluateReview(d).manualUpdates.length).length,excludedCount=analysed.length-includedOffers().length;
    $('comparison-review-note').hidden=!manualCount&&!excludedCount;
    $('comparison-review-note').textContent=[manualCount?`${manualCount} included offer${manualCount===1?' has':'s have'} values or conditions you corrected.`:'',excludedCount?`${excludedCount} unsupported offer${excludedCount===1?' is':'s are'} not included in the ranking.`:''].filter(Boolean).join(' ');
    const rows=comparison.offers.filter(o=>o.valid), best=comparison.cheapest_feasible, cheapest=comparison.cheapest_overall||rows.find(o=>o.cost_rank===1);
    if(comparison.issues?.length){notice(comparison.issues.join(' '),true);}else notice('');
    const comparable=comparison.comparable&&!comparison.offers.some(o=>!o.valid);
    const usableBest=comparable?best:null;
    $('decision-summary').classList.toggle('warning',!usableBest);
    $('decision-summary').innerHTML=usableBest?`<span class="decision-icon">✓</span><div><h3>${escape(usableBest.name)} fits both cash limits.</h3><p>${cheapest&&cheapest.id!==usableBest.id?`${escape(cheapest.name)} has the lowest total cost, but exceeds ${cheapest.upfront_feasible?'your monthly payment limit':'your upfront cash budget'}. `:''}Among the offers within both limits, ${escape(usableBest.name)} has the lowest borrowing cost. ${cheapest&&cheapest.id!==usableBest.id?`The extra borrowing cost is ${money(usableBest.total_cost-cheapest.total_cost,currency)}. `:''}${rows.filter(o=>o.feasible).length} of ${rows.length} offers fit.</p></div>`:`<span class="decision-icon">!</span><div><h3>${comparable?'No offer fits both limits.':'Use matching loan amounts and terms.'}</h3><p>${comparable?'Review the monthly and upfront requirements below, then adjust your limits if appropriate.':'Use the same principal, currency and duration before interpreting a cost ranking.'}</p></div>`;
    $('offer-comparison').innerHTML=rows.map(o=>`<article class="offer-card ${usableBest?.id===o.id?'selected':''}"><div class="card-label">${usableBest?.id===o.id?'LOWEST COST WITHIN YOUR LIMITS':comparable&&cheapest?.id===o.id?'LOWEST COST OVERALL':'OFFER COMPARISON'}</div><h3>${escape(o.name)} <span class="offer-currency">${escape(o.currency)}</span></h3><div class="big-number">${money(o.total_cost,o.currency)}</div><div class="big-caption">Total interest + upfront fees</div><div class="offer-details"><span>Regular monthly payment</span><strong>${money(o.monthly_payment,o.currency)}</strong><span>Maximum instalment</span><strong>${money(o.max_monthly_payment,o.currency)}</strong><span>Upfront cash needed</span><strong>${money(o.upfront_cash,o.currency)}</strong><span>Nominal annual rate</span><strong>${pct(o.annual_rate_pct)}</strong><span>Effective annual cost</span><strong>${pct(o.annual_effective_cost)}</strong><span>Principal / duration</span><strong>${integerMoney(o.principal,o.currency)} / ${o.term_months} months</strong></div><div class="fit-check ${o.monthly_feasible?'':'fail'}">${o.monthly_feasible?'✓':'×'} ${o.monthly_feasible?'Within monthly limit':'Monthly payment exceeds limit'}</div><div class="fit-check ${o.upfront_feasible?'':'fail'}">${o.upfront_feasible?'✓':'×'} ${o.upfront_feasible?'Within upfront budget':'Upfront fee exceeds budget'}</div></article>`).join('');
    renderCharts(rows);
    const selected=$('schedule-offer').value;$('schedule-offer').innerHTML=rows.map(o=>`<option value="${escape(o.id)}">${escape(o.name)} (${escape(o.currency)})</option>`).join('');if(rows.some(o=>o.id===selected))$('schedule-offer').value=selected;else if(usableBest)$('schedule-offer').value=usableBest.id;renderSchedule();
  }catch(err){clearComparison();notice(`Comparison stopped: ${err.message}`,true);$('decision-summary').innerHTML='<p>Review the entered values and cash limits before comparing.</p>';}
}
function renderCharts(rows){
  const max=Math.max(...rows.map(o=>o.total_cost),1);
  $('cost-chart').innerHTML=rows.map(o=>`<div class="bar-line"><span>${escape(o.name.replace('Bank ','').slice(0,12))}</span><div class="bar-track"><span class="bar-interest" style="width:${o.interest_total/max*100}%"></span><span class="bar-fees" style="width:${o.upfront_cash/max*100}%"></span></div><strong>${integerMoney(o.total_cost,o.currency)}</strong></div>`).join('')+'<div class="bar-legend"><span><i class="legend-dot" style="background:#7970cf"></i>Interest</span><span><i class="legend-dot" style="background:#c9c3f1"></i>Upfront fees</span></div>';
  const W=440,H=170,left=48,right=12,top=8,bottom=29,maxP=Math.max(...rows.map(o=>o.principal)),maxT=Math.max(...rows.map(o=>o.term_months));const x=m=>left+m/maxT*(W-left-right),y=v=>top+(1-v/maxP)*(H-top-bottom);const colors=['#5146c6','#d08d54','#4c9c89','#9d6cae','#647ea0'];
  let svg=`<p class="chart-currency">Outstanding principal · ${escape(rows[0].currency)}</p><svg viewBox="0 0 ${W} ${H}" class="balance-svg" role="img" aria-label="Outstanding principal in ${escape(rows[0].currency)} declines to zero over the repayment term">`;
  for(const frac of [0,.5,1]){const yy=y(maxP*frac);svg+=`<line x1="${left}" x2="${W-right}" y1="${yy}" y2="${yy}" stroke="#e8ebf1"/><text x="${left-8}" y="${yy+4}" text-anchor="end" fill="#8991a2" font-size="9">${Math.round(maxP*frac/1000)}k</text>`;}
  rows.forEach((o,i)=>{const points=[`${x(0)},${y(o.principal)}`,...o.schedule.map(p=>`${x(p.month)},${y(p.closing)}`)].join(' ');svg+=`<polyline points="${points}" fill="none" stroke="${colors[i]}" stroke-width="2" opacity=".85"/>`;});
  for(const m of [0,Math.round(maxT/2),maxT])svg+=`<text x="${x(m)}" y="${H-8}" text-anchor="middle" fill="#8991a2" font-size="9">Month ${m}</text>`;
  svg+='</svg><div class="bar-legend">'+rows.map((o,i)=>`<span><i class="legend-dot" style="background:${colors[i]}"></i>${escape(o.name)}</span>`).join('')+'</div>';$('balance-chart').innerHTML=svg;
}
function renderSchedule(){if(!comparison)return;const o=comparison.offers.find(o=>o.id===$('schedule-offer').value);if(!o)return;$('schedule-body').innerHTML=o.schedule.map(s=>`<tr><td>${s.month}</td><td>${money(s.opening,o.currency)}</td><td>${money(s.interest,o.currency)}</td><td>${money(s.principal,o.currency)}</td><td>${money(s.payment,o.currency)}</td><td>${money(s.closing,o.currency)}</td></tr>`).join('');}
function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
function csvCell(v){let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function exportComparison(){if(!comparison||!canCompare())return;const result={application:'FundingFit',version:'2.4.0',exported_at:new Date().toISOString(),model:'Saved clause classifier in clause_model.json',currency:comparison.currency||comparisonCurrency(),limits:{...getLimits(),currency:comparison.currency||comparisonCurrency()},assumptions:[comparison.currency||comparisonCurrency(),'Fixed nominal annual rate / 12','Monthly amortisation with cent rounding','Upfront fees separately paid','No other costs'],comparison,review:analysed.map(d=>{const result=evaluateReview(d);return {id:d.id,name:d.name,included_in_comparison:!result.hardIssues.length&&!result.selectionBlocked,source_text:d.text,extracted_fields:d.fields,original_extraction_issues:d.issues,corrections:d.corrections,verified_terms:result.terms,scope_confirmations:d.review?.scope||{},manual_updates:result.manualUpdates,review_status:{ready:result.ready,hard_issues:result.hardIssues,review_issues:result.reviewIssues,selection_blocked:!!result.selectionBlocked,unsupported_selections:result.unsupportedSelections||{}},confirmed:d.confirmed,confirmed_at:d.confirmed_at,synthetic:d.synthetic};})};download('fundingfit-comparison.json',JSON.stringify(result,null,2),'application/json');}
function exportSchedule(){
  if(!comparison||!canCompare())return;
  const o=comparison.offers.find(x=>x.id===$('schedule-offer').value);if(!o)return;
  const cols=['currency','month','opening','interest','principal','payment','closing'];
  download('fundingfit-schedule.csv',[cols.join(','),...o.schedule.map(row=>cols.map(key=>csvCell(key==='currency'?o.currency:row[key])).join(','))].join('\r\n'),'text/csv');
}
async function loadSamples(){try{const response=await fetch('data/samples.json');if(!response.ok)throw new Error('Sample data unavailable');const samples=await response.json();documents=samples.filter(s=>['offer_a','offer_b','offer_c'].includes(s.id)).map(s=>({id:s.id,name:s.name,text:s.text,synthetic:true,kind:'TXT'}));if(documents.length!==3)throw new Error('Three case-study documents were not found');invalidate();renderDocuments();showStep('intake');notice('Three fictional offers added. Select “Analyse with AI” to identify their terms.');$('intake-panel').scrollIntoView({behavior:'smooth',block:'start'});}catch(err){notice(`The case study could not load: ${err.message}`,true);}}
async function loadMetrics(){try{const response=await fetch('data/model_metrics.json');if(!response.ok)throw new Error('Evaluation unavailable');evaluation=await response.json();const m=evaluation.model;const fmt=x=>`${(x*100).toFixed(1)}%`;$('metrics-display').innerHTML=`<div class="metric"><span>Retained clause-set accuracy</span><b>${fmt(m.accuracy)}</b></div><div class="metric"><span>Retained clause-set macro F1</span><b>${m.macro_f1.toFixed(3)}</b></div><div class="metric"><span>Clauses accepted at threshold</span><b>${fmt(m.coverage_at_review_threshold)}</b></div><div class="metric"><span>Keyword baseline accuracy</span><b>${fmt(evaluation.keyword_baseline.accuracy)}</b></div><small>${evaluation.heldout_clauses} unique fictional test clauses, ${evaluation.heldout_template_families} held-out wording families. This retained development set is not a fresh blind evaluation and does not establish accuracy on real offers.</small>`;}catch{$('metrics-display').textContent='See models/evaluation.json for the measured results.';}}
document.querySelectorAll('.step').forEach(b=>b.onclick=()=>showStep(b.dataset.step));
$('sample-btn').onclick=loadSamples;$('analyse-btn').onclick=runAnalysis;$('back-intake').onclick=()=>showStep('intake');$('compare-btn').onclick=()=>showStep('compare');
$('file-input').onchange=e=>addFiles(e.target.files);
$('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('file-input').click();}});
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(event==='drop')addFiles(e.dataTransfer.files);});
$('paste-btn').onclick=()=>{const text=$('offer-text').value.trim();if(text.length<30){notice('Paste an offer of at least 30 characters.',true);return;}if(text.length>30000||documents.length>=5){notice('Use fewer than 30,000 characters and no more than five offers.',true);return;}documents.push({id:`paste-${Date.now()}`,name:$('offer-name').value.trim()||`Offer ${documents.length+1}`,text,kind:'TEXT'});invalidate();renderDocuments();$('offer-name').value='';$('offer-text').value='';notice('Offer added. Run AI analysis, or add another offer to compare.');};
for(const id of ['monthly-limit','upfront-budget'])$(id).addEventListener('input',()=>{if(canCompare())renderComparison();});
$('generous-btn').onclick=()=>{$('monthly-limit').value=2000;$('upfront-budget').value=6000;renderComparison();};
$('export-btn').onclick=exportComparison;$('schedule-offer').onchange=renderSchedule;
$('schedule-export').onclick=exportSchedule;
$('help-toggle').onclick=()=>{if(currentStep==='help'){showStep(previousStep);return;}previousStep=currentStep;showStep('help');loadMetrics();};$('close-help').onclick=()=>showStep(previousStep);
$('reset-btn').onclick=()=>{documents=[];invalidate();renderDocuments();showStep('intake');notice('Workspace cleared. Your downloaded exports are unchanged.');};
clearComparison();renderDocuments();loadMetrics();
