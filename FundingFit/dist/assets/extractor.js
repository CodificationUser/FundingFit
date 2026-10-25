/* FundingFit portable trained-model inference. No service, key or CDN. */
import {reconstructClauses} from './document_text.js';
let model = null;
export const FIELD_NAMES = ['principal','annual_rate_pct','term_months','upfront_fee','rate_type','currency','other_costs'];
export function setModel(value) { model = value; return model; }
export async function loadModel(url = new URL('./clause_model.json', import.meta.url)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('The local AI model could not be loaded. Open the complete FundingFit.html application.');
  return setModel(await response.json());
}
function normalise(text) { return text.normalize('NFKC').toLowerCase().replace(/\s\s+/g, ' '); }
export function classifyClause(input) {
  if (!model) throw new Error('Load the trained clause model before extracting an offer.');
  const chars = Array.from(normalise(String(input))), counts = new Map();
  for (let n=model.ngram_range[0];n<=model.ngram_range[1];n++) {
    for (let i=0;i+n<=chars.length;i++) {
      const index=model.vocabulary[chars.slice(i,i+n).join('')];
      if (index !== undefined) counts.set(index,(counts.get(index)||0)+1);
    }
  }
  const features=[]; let norm=0;
  for (const [i,count] of counts) { const value=(1+Math.log(count))*model.idf[i]; features.push([i,value]); norm+=value*value; }
  norm=Math.sqrt(norm);
  const logits=model.intercepts.map((bias,c)=>bias+features.reduce((sum,[i,value])=>sum+model.coefficients[c][i]*value/norm,0));
  const maximum=Math.max(...logits),exps=logits.map(x=>Math.exp(x-maximum)),total=exps.reduce((a,b)=>a+b,0);
  const probabilities=Object.fromEntries(model.classes.map((label,i)=>[label,exps[i]/total]));
  const ranked=Object.entries(probabilities).sort((a,b)=>b[1]-a[1]);
  const margin=ranked[0][1]-ranked[1][1];
  return {label:ranked[0][0],confidence:ranked[0][1],probabilities,margin,
    accepted:features.length>0&&ranked[0][1]>=model.minimum_confidence&&margin>=model.minimum_margin,
    confidence_is_calibrated:false};
}
function numericValue(raw) {
  let value=raw.replace(/[\s\u00a0]/g,'').replace(/[.,]+$/,'');
  if(value.includes(',')&&value.includes('.')) value=value.lastIndexOf(',')>value.lastIndexOf('.')?value.replace(/\./g,'').replace(',','.'):value.replace(/,/g,'');
  else if(value.includes(',')) { const parts=value.split(',');value=parts.slice(1).every(x=>x.length===3)?parts.join(''):value.replace(',','.'); }
  const number=Number(value); return value&&Number.isFinite(number)?number:null;
}
function numbers(text) {
  text=text.replace(/^\s*\d+[.)]\s+/,'');
  return [...text.matchAll(/[-+]?\d[\d.,]*(?:[ \u00a0]\d{3})*/g)].map(x=>numericValue(x[0])).filter(x=>x!==null);
}
function zeroCost(text) {
  const t=text.toLowerCase();
  if(/\b(unspecified|unknown|undisclosed|missing|unavailable)\b|not\s+(?:been\s+)?(?:supplied|disclosed|provided|specified)|except|excluding|apart from/.test(t))return false;
  return /\b(none|nil|zero|waived)\b/.test(t)||(/\bno\b/.test(t)&&/\b(costs?|charges?|fees?|premiums?|insurance|commissions?)\b/.test(t));
}
function currencies(text) {
  // A bare dollar sign does not distinguish US, Canadian or Australian dollars.
  // Explicit unsupported codes are still detected so that a document cannot be
  // relabelled as USD merely because it contains "$".
  const recognised=[
    ['EUR',/\bEUR\b|\beuros?\b|€/i],
    ['USD',/\bUSD\b|\bU\.?S\.?\s+dollars?\b|\bUS\$/i],
    ['GBP',/\bGBP\b|\b(?:British|sterling)\s+pounds?\b|\bpounds?\s+sterling\b|£/i],
    ['CAD',/\bCAD\b|\bCanadian\s+dollars?\b|\bCA\$|\bC\$/i],
    ['AUD',/\bAUD\b|\bAustralian\s+dollars?\b|\bAU\$|\bA\$/i],
    ['NZD',/\bNZD\b|\bNew\s+Zealand\s+dollars?\b|\bNZ\$/i],
    ['CHF',/\bCHF\b|\bSwiss\s+francs?\b/i],
    ['JPY',/\bJPY\b|\bJapanese\s+yen\b/i],
    ['CNY',/\bCNY\b|\bChinese\s+(?:yuan|renminbi)\b/i],
    ['INR',/\bINR\b|\bIndian\s+rupees?\b/i],
  ].filter(([,pattern])=>pattern.test(text)).map(([currency])=>currency);
  // Retain other explicit code-only currency fields as unsupported rather than
  // treating them as absent. Uppercase codes and a complete line avoid reading
  // ordinary phrases such as "currency: the euro" as an invented code.
  const explicitCodes=[...text.matchAll(/^\s*(?:currency|settlement currency|loan currency)\s*[:=]\s*([A-Z]{3})\s*\.?\s*$/gim)]
    .map(match=>match[1]).filter(code=>/^[A-Z]{3}$/.test(code));
  return [...new Set([...recognised,...explicitCodes])];
}
function rateType(text) {
  const t=text.toLowerCase().replace(/\bnot\s+(?:a\s+)?(?:variable|floating|adjustable)\b/g,'');
  if(/\b(variable|floating|adjustable|floats)\b|not\s+fixed/.test(t))return 'variable';
  if(/\bfixed\b|will not change|unchanged|constant rate/.test(t))return 'fixed';
  return null;
}
function parse(label,text) {
  if(['principal','upfront_fee','other_costs'].includes(label)) {
    if(/\d[\d.,]*\s*(?:k|m|bn|thousands?|millions?|billions?)\b/i.test(text))return null;
    if(label==='other_costs'&&/early repayment|prepayment|after month|after year/i.test(text))return null;
    const ns=numbers(text); if(ns.length===1&&!text.includes('%'))return ns[0];
    const generalCostStatement=label!=='other_costs'||/\b(other|additional|ancillary|supplementary|extra|all)\b/i.test(text);
    if(label!=='principal'&&!ns.length&&zeroCost(text)&&generalCostStatement)return 0;
  } else if(label==='annual_rate_pct') {
    if(/euribor|libor|sofr|sonia|benchmark|\bmargin\b|for information only/i.test(text))return null;
    const ns=[...text.matchAll(/([-+]?\d+(?:[.,]\d+)?)\s*%/g)].map(x=>numericValue(x[1]));
    if(ns.length===1&&/annual|annum|year|p\.a\./i.test(text)) {
      if(/\bAPR\b|annual effective|effective annual/i.test(text)&&!/nominal/i.test(text))return null;
      return ns[0];
    }
  } else if(label==='term_months') {
    const values=[...text.matchAll(/([-+]?\d+(?:[.,]\d+)?)\)?\s*(months?|years?)\b/gi)].map(x=>numericValue(x[1])*(x[2].toLowerCase().startsWith('year')?12:1));
    if(values.length&&new Set(values).size===1&&Number.isInteger(values[0]))return values[0];
  } else if(label==='rate_type'){
    if(!/[:=]|\b(is|has|carries|uses|remains|applies|unchanged|will|constant)\b|fixed.rate loan|variable.rate loan|\b(?:fixed|variable|floating)\b.*\b(?:rate|interest)\b|\b(?:rate|interest)\b.*\b(?:fixed|variable|floating)\b/i.test(text))return null;
    return rateType(text);
  }
  else if(label==='currency') {const cs=currencies(text);return cs.length===1?cs[0]:null;}
  return null;
}
function documentScopeGuards(clauses,fields) {
  const issues=[];
  function block(field,clause,message,status='unsupported',clear=false){
    issues.push(message);
    if(field){fields[field].status=status;if(clear)Object.assign(fields[field],{value:null,source:clause.source??clause.text,line:clause.line,span:clause.span,segments:clause.segments||[],page:clause.page??null,confidence:clause.confidence});}
  }
  for(const clause of clauses){
    const source=clause.text,label=clause.label,t=source.toLowerCase();
    const costLike=/\b(fees?|charges?|commissions?|premiums?)\b|\b(?:other|additional|ancillary|supplementary|compulsory)\s+(?:costs?|expenses?)\b/.test(t);
    const modeOnly=/paid separately|separate (?:business )?cash|outside (?:of )?the loan|not (?:added|financed|borrowed)/.test(t)&&!numbers(t).length&&!t.includes('%');
    const explicitZero=zeroCost(source);
    const scaledAmount=/\d[\d.,]*\s*(?:k|m|bn|thousands?|millions?|billions?)\b/.test(t);
    const scaledDocument=/\b(?:figures|amounts|sums|values)\b[^\n]{0,45}\b(?:thousands?|millions?|billions?)\b/.test(t);
    if(scaledAmount||scaledDocument){const field=['principal','upfront_fee','other_costs'].includes(label)?label:null;block(field,clause,'Scaled monetary notation is unsupported. Supply full, unscaled numeric amounts.','unsupported',true);if(scaledDocument)for(const moneyField of ['principal','upfront_fee'])block(moneyField,clause,'Document-wide monetary scaling is unsupported. Supply full numeric principal and fee amounts.','unsupported',true);}
    const bounded=/\bup to\b|\bat least\b|\bat most\b|\bapproximately\b|\bapprox\.?\b|\bminimum\b|\bmaximum\b|\bbetween\b|\bindicative\b|\bestimated\b/.test(t);
    const conditional=/\bonly if\b|\bsubject to\b|\bprovided that\b|\bcontingent\b|\bconditional\b|\bif\b/.test(t);
    const fieldLike=['principal','annual_rate_pct','term_months','upfront_fee','other_costs'].includes(label);
    if(fieldLike&&(bounded||(conditional&&costLike))&&!modeOnly)block(label,clause,`${label}: a bound, estimate, range or condition is not an exact agreed value. Revise or clarify the document.`,'ambiguous',true);
    if(/\bprincipal\b/.test(t)&&/\bindicative\b|not an? approved|not an? agreed|not confirmed/.test(t))block('principal',clause,'The principal is described as indicative or unapproved. An exact agreed amount is required.','ambiguous',true);
    const extraCost=/\b(additional|extra|recurring|annual|yearly|monthly|quarterly|mandatory|compulsory|guarantee|insurance|broker|brokerage|servicing|valuation)\b/.test(t);
    const parsed=clause.accepted&&label!=='other'?parse(label,source):null;
    if(clause.accepted&&fieldLike&&parsed===null&&!modeOnly&&!(label==='other_costs'&&explicitZero)){
      const message=`${label}: a recognised financial clause could not be parsed. Clarify it before comparison.`;
      if(fields[label].value!==null)block(label,clause,message,'ambiguous',true);else issues.push(message);
    }
    if(costLike&&!explicitZero&&!modeOnly&&!clause.heading){
      if(extraCost||!['upfront_fee','other_costs'].includes(label)||parsed===null){const field=label==='upfront_fee'&&!extraCost?'upfront_fee':'other_costs';block(field,clause,'A positive, conditional or unresolved cost clause is outside the zero-other-costs scope. Clarify all costs before comparison.','unsupported',true);}
    }
    const rateContext=/\b(rate|interest)\b/.test(t);
    const cleanedRate=t.replace(/\bnot\s+(?:variable|floating|adjustable|indexed|reset)\b/g,'');
    const futureChange=/\b(?:may|can|will)\s+(?:be\s+)?(?:change|changed|vary|varied|reset|reviewed|revised)\b|\bresets?\b|\b(?:euribor|libor|sofr|sonia|benchmark|index.linked|indexed)\b|\bintroductory\b|\bfixed\b[^\n]{0,35}\bfirst\b/.test(cleanedRate);
    if(rateContext&&futureChange)block('rate_type',clause,'An introductory, resettable or benchmark-linked rate is unsupported. A rate fixed for the entire loan is required.');
    if(/\bmonthly\s+(?:nominal\s+)?interest\s+rate\b|\binterest\s+rate\b[^\n]{0,35}\bper month\b/.test(t))block('annual_rate_pct',clause,'A monthly interest rate conflicts with the required nominal annual rate.');
    if(/compound(?:ed|ing)?[^.;\n]{0,25}\b(daily|quarterly|annually|annual|yearly|semi.annually|continuous|continuously)\b|\b(daily|quarterly|annually|annual|yearly|semi.annually|continuously)\s+compound(?:ed|ing)?/.test(t))block('annual_rate_pct',clause,'Non-monthly compounding is outside the annual-nominal-rate-divided-by-12 convention.');
    if(/\binterest\b/.test(t)&&/capitali[sz](?:ed|ation)|added to (?:the )?(?:loan )?balance/.test(t))block(null,clause,'Capitalised or unpaid interest added to the balance is unsupported.');
    const repaymentContext=/\b(repayments?|payments?|instalments?|installments?)\b/.test(t);
    const nonmonthly=/\b(quarterly|weekly|fortnightly|annually|yearly|semi.annual(?:ly)?|biweekly)\b|\bevery\s+(?:3|three|6|six|12|twelve)\s+months\b|\bnot\s+monthly\b/.test(t);
    if(repaymentContext&&nonmonthly)block(null,clause,'A non-monthly or contradictory repayment frequency is unsupported.');
  }
  return issues;
}
export function extractOffer(input,options={}) {
  if(!model)throw new Error('Load the trained clause model before extracting an offer.');
  const text=String(input),candidates=Object.fromEntries(FIELD_NAMES.map(x=>[x,[]])),clauses=[],issues=(options.layoutWarnings||[]).map(w=>`PDF layout review required: ${w}`);
  let parseText=text;
  if(text.length>100000){issues.push('The text exceeds the supported 100,000 character limit. Use a short offer extract.');parseText='';}
  for(const fragment of reconstructClauses(parseText,options.layoutLines||[])){
    const source=fragment.text,prediction=classifyClause(source);
    if(fragment.heading||fragment.boilerplate||(prediction.label==='term_months'&&/instalments?|installments?|repayments?|payments?/i.test(source)&&!/\d+\)?\s*(?:months?|years?)\b|duration|tenor|\bterm\b/i.test(source))){prediction.label='other';prediction.accepted=false;}
    const clause={...fragment,...prediction};clauses.push(clause);
    if(!prediction.accepted||prediction.label==='other')continue;
    const label=prediction.label,value=parse(label,source),candidate={value,source:fragment.source,line:fragment.line,span:fragment.span,segments:fragment.segments,page:fragment.page,confidence:prediction.confidence,status:'extracted'};
    if(value!==null)candidates[label].push(candidate);
    if(['principal','upfront_fee','annual_rate_pct'].includes(label)){
      const cs=currencies(source);if(cs.length===1)candidates.currency.push({...candidate,value:cs[0]});
    }
    if(['annual_rate_pct','rate_type'].includes(label)){
      const type=rateType(source);if(type)candidates.rate_type.push({...candidate,value:type});
      const annual=parse('annual_rate_pct',source);if(annual!==null)candidates.annual_rate_pct.push({...candidate,value:annual});
    }
  }
  const fields={};
  for(const [field,values] of Object.entries(candidates)) {
    const distinct=new Set(values.map(x=>String(x.value)));
    if(!values.length){fields[field]={value:null,source:'',line:null,span:null,confidence:0,status:'missing'};issues.push(`${field}: no explicit, sufficiently confident value was found. Review or supply the missing information.`);}
    else if(distinct.size>1){fields[field]={value:null,source:'',line:null,span:null,confidence:Math.max(...values.map(x=>x.confidence)),status:'ambiguous',candidates:values};issues.push(`${field}: conflicting values were found. Resolve the source documents before comparison.`);}
    else {const direct=values.filter(v=>clauses.some(c=>c.line===v.line&&c.label===field));fields[field]=(direct.length?direct:values).reduce((a,b)=>a.confidence>b.confidence?a:b);}
  }
  if(currencies(text).length>1){issues.push('More than one currency appears in the document. Mixed-currency offers are unsupported.');fields.currency.status='unsupported';}
  const documentCurrencies=currencies(text);
  if(/\$/.test(text)&&documentCurrencies.length&&
      !documentCurrencies.some(code=>['USD','CAD','AUD','NZD'].includes(code))){
    fields.currency.status='unsupported';
    issues.push('The document combines a non-dollar currency with a dollar sign. Clarify the currency of every amount before comparison.');
  }
  if(documentCurrencies.length===1&&!['EUR','USD','GBP'].includes(documentCurrencies[0])){
    fields.currency.value=documentCurrencies[0];fields.currency.status='unsupported';
    issues.push('currency: the document specifies a currency outside EUR, USD and GBP.');
  }
  const limits={principal:x=>x>0,annual_rate_pct:x=>x>=0&&x<=50,term_months:x=>Number.isInteger(x)&&x>=1&&x<=120,upfront_fee:x=>x>=0,rate_type:x=>x==='fixed',currency:x=>['EUR','USD','GBP'].includes(x),other_costs:x=>x===0};
  for(const [field,valid]of Object.entries(limits)){const value=fields[field].value;if(value!==null&&!valid(value)){fields[field].status='unsupported';issues.push(`${field}: the extracted value is outside the supported product scope.`);}}
  if(fields.principal.value!==null&&fields.upfront_fee.value!==null&&fields.upfront_fee.value>=fields.principal.value){fields.upfront_fee.status='unsupported';issues.push('The upfront fee must be smaller than the principal.');}
  const guardText=clauses.map(c=>c.text).join('\n');
  const negativeRepayment=/\bnot\s+(?:(?:repay|pay)\s+)?(?:the\s+)?same amount\b|\bnot\s+(?:equal|constant|level)\b|\b(unequal|irregular)\s+(?:monthly\s+)?(?:payments?|instalments?|installments?)\b|\bmonthly\s+(?:payments?|instalments?|installments?)[^\n.]{0,25}\bnot\s+(?:equal|constant|level)\b/i.test(guardText);
  const repayment_confirmed=/\b(equal|constant|level)\b[^\n]{0,55}\bmonthly\b|\bmonthly\b[^\n]{0,35}\b(equal|constant|level)\b|\b(?:same|constant) amount\b[^\n]{0,30}\bevery month\b/i.test(guardText)&&!negativeRepayment;
  const negativeFeePayment=/\bnot\s+paid\s+separately\b|\bnot\s+(?:from\s+)?separate\s+(?:business\s+)?cash\b/i.test(guardText);
  const fee_payment_confirmed=(/paid separately|separate (?:business )?cash|outside (?:of )?the loan|not (?:added|financed|borrowed)/i.test(guardText)&&!negativeFeePayment)||fields.upfront_fee.value===0;
  if(!repayment_confirmed)issues.push('Equal monthly repayments were not explicitly confirmed. Other repayment structures are unsupported.');
  if(!fee_payment_confirmed)issues.push('Payment of the upfront fee separately at drawdown was not explicitly confirmed.');
  for(const clause of clauses){const t=clause.text.toLowerCase();
    if(/payment holiday|grace period|balloon|interest deferral|deferred interest|interest.only/.test(t)){
      const explicitAbsence=/\b(no|without|none)\b/.test(t)&&!numbers(t).length&&!/\b(but|except|unless|however)\b/.test(t);
      if(!explicitAbsence)issues.push('A payment holiday, balloon, deferred-interest or interest-only structure may be present. It is unsupported.');
    }
    const financeText=t.replace(/\bnot\s+financed\s+in\s+or\s+withheld\s+from/g,'not financed in and not withheld from');
    const positiveFinancingText=financeText.replace(/\bnot\s+(?:financed|added\s+to|deducted\s+from|withheld\s+from)\b/g,'');
    if(/fee|charge/.test(t)&&/financed|added to|deducted from|withheld from/.test(positiveFinancingText)&&/loan|principal|advance/.test(t))issues.push('Fees financed in or withheld from the principal are unsupported.');
  }
  if(/indicative\s+term\s+sheet|subject to final credit approval|does not constitute a binding commitment/i.test(guardText))issues.push('This is an indicative or non-binding term sheet. Confirm the agreed contractual terms before comparison.');
  for(const clause of clauses){const t=clause.text.toLowerCase();if(/\b(?:interest|rate)\b/.test(t)&&rateType(t)==='variable'){fields.rate_type.status='unsupported';issues.push('A variable or floating rate is unsupported; the rate must be fixed for the entire loan.');}}
  issues.push(...documentScopeGuards(clauses,fields));
  const supported=!issues.length&&Object.values(fields).every(x=>x.status==='extracted');
  return {id:options.id||'imported-offer',name:options.name||'Imported offer',text,fields,clauses,issues:[...new Set(issues)],supported,repayment_confirmed,fee_payment_confirmed,requires_user_confirmation:true,model_name:model.name,confidence_is_calibrated:false};
}
