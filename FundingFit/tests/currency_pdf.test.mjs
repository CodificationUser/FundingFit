import './helpers/pdfjs_text_environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readPdfDocument} from '../dist/assets/pdf_reader.js';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
import {evaluateReview} from '../dist/assets/review.js';
import {calculateLoan} from '../dist/assets/finance.js';

setModel(JSON.parse(readFileSync(new URL('../dist/assets/clause_model.json',import.meta.url))));

// Small, valid text PDFs generated in memory keep these regressions portable.
function textPdf(lines){
  const escape=s=>s.replace(/[\\()]/g,c=>'\\'+c);
  const stream='BT /F1 10 Tf 40 780 Td 14 TL\n'+lines.map((s,i)=>(i?'T* ':'')+'('+escape(s)+') Tj').join('\n')+'\nET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((body,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${body}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}
function lines(currency){
  const unit=currency?currency+' ':'';
  return ['FICTIONAL BUSINESS LOAN OFFER',...(currency?[`Currency: ${currency}.`]:[]),
    `Principal amount: ${unit}100000.`, 'Nominal annual interest rate: 4.10%.',
    'Rate type: fixed for the entire loan.', 'Loan term: 60 months.',
    'Repayment: equal monthly instalments of principal and interest.',
    `Upfront arrangement fee: ${unit}800.`,
    'Fee payment: paid separately at drawdown; not financed in the loan principal.',
    'Other costs: none.', 'No payment holiday, balloon payment or deferred interest applies.'];
}
async function extract(pdfLines){
  const document=await readPdfDocument(textPdf(pdfLines));
  return extractOffer(document.text,{layoutLines:document.lines,layoutWarnings:document.warnings});
}
for(const currency of ['USD','GBP']){
  test(`actual ${currency} PDF is classified, reviewed and calculated in its own currency`,async()=>{
    const offer=await extract(lines(currency));
    assert.equal(offer.fields.currency.value,currency);
    assert.equal(offer.fields.currency.page,1);
    const reviewed=evaluateReview(offer);
    assert.equal(reviewed.ready,true,reviewed.hardIssues.concat(reviewed.reviewIssues).join('; '));
    const result=calculateLoan(reviewed.terms);
    assert.equal(result.currency,currency);
    assert.equal(result.principal,100000);
    assert.equal(result.upfront_fee,800);
  });
}
test('an actual PDF without a currency can be completed as USD without altering its amounts',async()=>{
  const offer=await extract(lines(null));
  assert.equal(offer.fields.currency.value,null);
  assert.equal(evaluateReview(offer).ready,false);
  const reviewed=evaluateReview({...offer,review:{scope:{currency:'USD'}}});
  assert.equal(reviewed.ready,true,reviewed.hardIssues.concat(reviewed.reviewIssues).join('; '));
  assert.equal(reviewed.terms.currency,'USD');assert.equal(reviewed.terms.principal,100000);
  assert.equal(offer.fields.currency.value,null);
});
test('currencies mixed inside one PDF remain a source conflict',async()=>{
  const offer=await extract([...lines('USD'),'Settlement currency: EUR.']);
  const reviewed=evaluateReview({...offer,review:{scope:{currency:'USD'}}});
  assert.equal(reviewed.ready,false);assert.ok(reviewed.hardIssues.length>0);
});
