/**
 * Human review of AI proposals. The source extraction is never changed here.
 * A missing proposal can be completed after checking the document;
 * a product the source explicitly describes as unsupported cannot be overridden.
 */
import {calculateLoan, SUPPORTED_CURRENCIES} from './finance.js';

export const REVIEW_NUMERIC_FIELDS = ['principal','annual_rate_pct','term_months','upfront_fee'];
export const REVIEW_SCOPE_FIELDS = ['currency','rate_type','other_costs','repayment_confirmed','fee_payment_confirmed'];
const names={principal:'loan amount',annual_rate_pct:'nominal annual rate',term_months:'repayment term in months',upfront_fee:'upfront fee',currency:'currency',rate_type:'interest type',other_costs:'other charges'};
const own=(object,key)=>Object.hasOwn(object||{},key);
const unique=values=>[...new Set(values)];
const number=value=>((typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value)))?Number(value):null;
const extracted=(item,key)=>item.fields?.[key]?.status==='extracted'?item.fields[key].value:null;

function sourceText(item){return (item.clauses?.length?item.clauses.map(c=>c.text).join('\n'):String(item.text||'')).toLowerCase();}
function separatePaymentInSource(text){
  return /paid separately|separate (?:business )?cash|outside (?:of )?the loan|not (?:added|financed|borrowed)/i.test(text)&&
    !/\bnot\s+paid\s+separately\b|\bnot\s+(?:from\s+)?separate\s+(?:business\s+)?cash\b/i.test(text);
}

function recoverableMissingFee(item){
  const field=item.fields?.upfront_fee;
  // This is absence of a fee clause, not a known additional or conditional fee.
  // It still needs a numeric entry; an unknown fee is never assumed to be zero.
  return field?.value==null&&field?.source&&
    /not\s+(?:been\s+)?(?:supplied|provided|specified|disclosed)|\b(?:missing|unknown|unspecified|undisclosed)\b/i.test(field.source)&&
    !/\d/.test(field.source)&&item.fields?.other_costs?.status==='extracted'&&item.fields.other_costs.value===0;
}

export function hardReviewIssues(item){
  const hard=[];
  const missing=/^(principal|annual_rate_pct|term_months|upfront_fee|rate_type|currency|other_costs): no explicit, sufficiently confident value was found\./;
  const unparsed=/^(principal|annual_rate_pct|term_months|upfront_fee|rate_type|currency|other_costs): a recognised financial clause could not be parsed\./;
  const numericRange=/^(principal|annual_rate_pct|term_months|upfront_fee): the extracted value is outside the supported product scope\./;
  for(const issue of item.issues||[]){
    if(missing.test(issue)||unparsed.test(issue)||numericRange.test(issue)||
      issue==='Equal monthly repayments were not explicitly confirmed. Other repayment structures are unsupported.'||
      issue==='Payment of the upfront fee separately at drawdown was not explicitly confirmed.'||
      issue==='The upfront fee must be smaller than the principal.')continue;
    if(issue==='A positive, conditional or unresolved cost clause is outside the zero-other-costs scope. Clarify all costs before comparison.'&&recoverableMissingFee(item))continue;
    hard.push(issue);
  }
  for(const [key,valid]of [['currency',v=>SUPPORTED_CURRENCIES.includes(String(v).toUpperCase())],['rate_type',v=>String(v).toLowerCase()==='fixed'],['other_costs',v=>v===0]]){
    const field=item.fields?.[key];
    if(field?.value!=null&&!valid(field.value))hard.push(`The source ${names[key]} is outside the supported product scope. Manual entries cannot override it.`);
    if(field?.status==='unsupported')hard.push(`The source contains an unsupported ${names[key]} condition. A different or revised source document is required.`);
  }
  for(const [key,field]of Object.entries(item.fields||{})){
    if(field.candidates&&new Set(field.candidates.map(c=>String(c.value))).size>1)hard.push(`Conflicting ${names[key]||key} values in the source require a revised document.`);
  }
  const text=sourceText(item);
  if(/\bnot\s+(?:(?:repay|pay)\s+)?(?:the\s+)?same amount\b|\bnot\s+(?:equal|constant|level)\b|\b(?:unequal|irregular)\s+(?:monthly\s+)?(?:payments?|instalments?|installments?)\b|\bmonthly\s+(?:payments?|instalments?|installments?)[^\n.]{0,25}\bnot\s+(?:equal|constant|level)\b/.test(text))hard.push('The source states that repayments are not equal monthly instalments. Manual confirmation cannot override this structure.');
  if(/\bnot\s+paid\s+separately\b|\bnot\s+(?:from\s+)?separate\s+(?:business\s+)?cash\b/.test(text))hard.push('The source states that fees are not paid separately. This payment structure is unsupported.');
  return unique(hard);
}

export function evaluateReview(item){
  const correction=item.corrections||{},review=item.review||{},scope=review.scope||{};
  const manualUpdates=[];
  const terms={id:item.id,name:item.name};
  for(const key of REVIEW_NUMERIC_FIELDS){
    const raw=own(correction,key)?correction[key]:extracted(item,key);
    terms[key]=number(raw);
    if(own(correction,key))manualUpdates.push({field:key,from:item.fields?.[key]?.value??null,value:terms[key]});
  }
  const baseScope={currency:extracted(item,'currency'),rate_type:extracted(item,'rate_type'),other_costs:extracted(item,'other_costs'),
    repayment_confirmed:item.repayment_confirmed===true?true:null,
    fee_payment_confirmed:item.fee_payment_confirmed===true?true:null};
  // A zero original fee was sufficient for the extraction flag. A replacement
  // positive fee needs its own separately-paid convention; that flag is stale.
  if(item.fields?.upfront_fee?.value===0&&terms.upfront_fee>0&&!separatePaymentInSource(sourceText(item)))baseScope.fee_payment_confirmed=null;
  for(const key of REVIEW_SCOPE_FIELDS){
    let value=own(scope,key)?scope[key]:baseScope[key];
    if(value==null||typeof value==='string'&&value.trim()==='')value=null;
    else if(key==='currency'&&typeof value==='string')value=value.trim().toUpperCase();
    else if(key==='rate_type'&&typeof value==='string')value=value.trim().toLowerCase();
    else if(key==='other_costs'&&value==='0')value=0;
    else if(['repayment_confirmed','fee_payment_confirmed'].includes(key)&&['true','false'].includes(value))value=value==='true';
    terms[key]=value;
    if(own(scope,key))manualUpdates.push({field:key,from:baseScope[key]??null,value:terms[key]});
  }
  if(terms.upfront_fee===0&&!own(scope,'fee_payment_confirmed'))terms.fee_payment_confirmed=true;
  const fieldErrors={};
  const require=(key,message)=>{if(!fieldErrors[key])fieldErrors[key]=message;};
  for(const key of REVIEW_NUMERIC_FIELDS)if(terms[key]===null)require(key,`Enter the ${names[key]}. Leave it blank until you know the value.`);
  if(terms.principal!==null&&terms.principal<=0)require('principal','Enter a positive loan amount.');
  if(terms.annual_rate_pct!==null&&(terms.annual_rate_pct<0||terms.annual_rate_pct>50))require('annual_rate_pct','Enter a nominal annual rate between 0% and 50%.');
  if(terms.term_months!==null&&(!Number.isInteger(terms.term_months)||terms.term_months<1||terms.term_months>120))require('term_months','Enter a whole number of months between 1 and 120.');
  if(terms.upfront_fee!==null&&(terms.upfront_fee<0||terms.principal!==null&&terms.upfront_fee>=terms.principal))require('upfront_fee','Enter a nonnegative fee below the loan amount.');
  if(!SUPPORTED_CURRENCIES.includes(terms.currency))require('currency',terms.currency==null?'Select the currency shown in the offer.':'This currency is not supported. Choose an offer in EUR, USD or GBP.');
  if(terms.rate_type!=='fixed')require('rate_type',terms.rate_type==null?'Confirm whether the rate is fixed for the whole loan.':'This calculator supports rates fixed for the whole loan only.');
  if(terms.other_costs!==0)require('other_costs',terms.other_costs==null?'Confirm whether any other charges apply.':'Additional or conditional charges are not supported.');
  if(terms.repayment_confirmed!==true)require('repayment_confirmed',own(scope,'repayment_confirmed')&&terms.repayment_confirmed===false?'Unequal or non-monthly repayments are not supported. Correct the selection only if it does not match the offer.':'Confirm equal monthly repayments of principal and interest.');
  if(terms.upfront_fee!==0&&terms.fee_payment_confirmed!==true)require('fee_payment_confirmed',own(scope,'fee_payment_confirmed')&&terms.fee_payment_confirmed===false?'Fees financed in or deducted from the loan are not supported.':'Confirm that the upfront fee is paid separately, not financed or deducted from the loan.');
  if(REVIEW_NUMERIC_FIELDS.every(key=>terms[key]!==null)){
    try{calculateLoan(terms);}catch(error){
      for(const message of error.issues||[error.message]){
        const key=REVIEW_NUMERIC_FIELDS.find(field=>message.startsWith(field));
        if(key==='principal')require(key,'Enter a positive loan amount within the supported monetary range.');
        else if(key==='annual_rate_pct')require(key,'Enter a nominal annual rate between 0% and 50%.');
        else if(key==='term_months')require(key,'Enter a whole number of months between 1 and 120.');
        else if(key==='upfront_fee')require(key,'Enter a nonnegative fee below the loan amount.');
        else if(!/Only fixed-rate|^currency\b/.test(message))require('calculation',message);
      }
    }
  }
  const hardIssues=hardReviewIssues(item);
  const supportedChoice={currency:v=>SUPPORTED_CURRENCIES.includes(v),rate_type:v=>v==='fixed',other_costs:v=>v===0,repayment_confirmed:v=>v===true,fee_payment_confirmed:v=>terms.upfront_fee===0||v===true};
  const unsupportedSelections={};
  for(const key of REVIEW_SCOPE_FIELDS){
    if(own(scope,key)&&terms[key]!==null&&!supportedChoice[key](terms[key]))unsupportedSelections[key]=fieldErrors[key]||'This selected condition is not supported.';
  }
  const selectionBlocked=Object.keys(unsupportedSelections).length>0;
  const reviewIssues=unique(Object.values(fieldErrors));
  const missingFields=Object.keys(fieldErrors).filter(key=>key!=='calculation');
  const blockedSummary=hardIssues.length?summarizeBlock(item,hardIssues):'';
  return {ready:hardIssues.length===0&&!selectionBlocked&&reviewIssues.length===0,terms,hardIssues,reviewIssues,manualUpdates,fieldErrors,missingFields,blockedSummary,selectionBlocked,unsupportedSelections};
}

function summarizeBlock(item,issues){
  const reasons=issues.join(' ').toLowerCase();
  if(item.fields?.rate_type?.value==='variable'||/variable|floating|benchmark.linked|resettable|introductory/.test(reasons))return 'This offer uses a variable or changing rate. The calculator supports rates fixed for the whole loan only.';
  if(/financed in|withheld from|fees are not paid separately/.test(reasons))return 'Fees are financed in or deducted from the loan. The calculator supports fees paid separately only.';
  if(/unsupported other charges|positive, conditional or unresolved cost|conditional.*cost|additional.*cost/.test(reasons))return 'This offer includes additional or unresolved charges that the calculator cannot include. Choose another offer.';
  if(/monthly interest rate/.test(reasons))return 'The stated rate uses a monthly convention. The calculator requires a nominal annual rate.';
  if(/conflict|contradict|mixed.currency/.test(reasons))return 'The document contains conflicting terms. Use a corrected offer before comparing.';
  if(/currency/.test(reasons))return 'This offer uses an unsupported or inconsistent currency. The calculator supports EUR, USD and GBP without converting between them.';
  if(/layout|column|rotated|scal/.test(reasons))return 'The document layout or amount notation cannot be read reliably. Use a clearer document with full numeric amounts.';
  if(/indicative|non.binding|final credit approval/.test(reasons))return 'These terms are indicative or conditional. Use an offer with confirmed terms before comparing.';
  if(/bound|estimate|range|not an exact/.test(reasons))return 'This document gives approximate, ranged or conditional amounts. Use an offer with exact figures.';
  if(/repay|instalment|installment|payment holiday|balloon|deferred|capitalised|interest.only|compounding/.test(reasons))return 'This offer uses a repayment or interest structure the calculator does not support.';
  return 'This offer contains conditions the calculator does not support. Choose another offer.';
}
