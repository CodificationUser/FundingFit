import './helpers/pdfjs_text_environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconstructPage,readPdfDocument} from '../dist/assets/pdf_reader.js';

const root=new URL('../data/layout_examples/',import.meta.url);
const cases=JSON.parse(readFileSync(new URL('expected_cases.json',root),'utf8'));
const item=(str,x,y,width=str.length*5,height=10,fontName='regular')=>({str,width,height,fontName,transform:[height,0,0,height,x,y],hasEOL:false});

function verifyOffsets(result) {
  for(const line of result.lines){
    assert.equal(result.text.slice(line.start,line.end),line.text);
    assert.ok(Number.isInteger(line.page)&&line.page>0);
    assert.ok(line.boxes.length>0);
    for(const box of line.boxes){assert.ok(Number.isFinite(box.x)&&Number.isFinite(box.y));assert.ok(box.text.length>0);}
  }
}

test('position reconstruction ignores PDF object order and preserves source boxes',()=>{
  const result=reconstructPage([item('EUR 80,000',210,700),item('60 months',210,675),item('Duration',50,675),item('Loan amount',50,700)]);
  assert.deepEqual(result.lines.map(l=>l.text),['Loan amount EUR 80,000','Duration 60 months']);
  assert.equal(result.lines[0].boxes.length,2);
  assert.equal(result.lines[0].association.type,'same_row');
});
test('separate card headings are paired only with values in their own columns',()=>{
  const result=reconstructPage([item('You borrow',50,700),item('Over',220,700),item('Your rate',390,700),item('4.9% per annum',390,678),item('EUR 80,000',50,678),item('60 months',220,678),item('fixed nominal rate',390,660),item('monthly repayments',220,660)]);
  assert.deepEqual(result.lines.map(l=>l.text),['You borrow EUR 80,000','Over 60 months monthly repayments','Your rate 4.9% per annum fixed nominal rate']);
  assert.ok(result.lines.every(l=>l.association.type==='aligned_column'));
});
test('ambiguous or misaligned cards never borrow a neighbour value',()=>{
  const result=reconstructPage([item('Loan amount',50,700),item('Interest rate',280,700),item('EUR 80,000',50,675),item('EUR 90,000',55,675),item('4.2%',280,675)]);
  assert.ok(result.warnings.some(w=>w.includes('ambiguous')));
  assert.ok(result.lines.every(l=>!l.association||l.association.type!=='aligned_column'));
});
test('unlabelled columns stay in distinct blocks and all clauses remain available',()=>{
  const result=reconstructPage([item('Independent left paragraph.',50,700),item('Insurance charge: EUR 500.',350,700)]);
  assert.equal(result.lines.length,2);
  assert.notEqual(result.lines[0].block,result.lines[1].block);
  assert.match(result.lines[1].text,/Insurance charge/);
});
test('table value continuation remains with its label without crossing the next row',()=>{
  const result=reconstructPage([item('Fee settlement',50,700),item('Paid separately at drawdown; not financed in',210,700),item('or withheld from principal.',210,686),item('Other costs',50,663),item('None',210,663)]);
  assert.equal(result.lines[0].text,'Fee settlement Paid separately at drawdown; not financed in or withheld from principal.');
  assert.equal(result.lines[1].text,'Other costs None');
});
test('ordinary leading digits and explicit article numbers are retained',()=>{
  const result=reconstructPage([item('3',50,700,5),item('years',60,700),item('Article 6 - Fees and charges',50,675)]);
  assert.match(result.lines[0].text,/3 years/);
  assert.match(result.lines[1].text,/Article 6/);
  assert.equal(result.decorations.length,0);
});
test('rotated text is reported instead of silently claiming layout support',()=>{
  const rotated=item('Annual interest rate 4.2%',50,700);rotated.transform=[0,10,-10,0,50,700];
  assert.ok(reconstructPage([rotated]).warnings.some(w=>w.includes('rotated')));
});
for(const row of cases){
  test(`actual PDF.js ingestion retains positioned source evidence: ${row.id}`,async()=>{
    const actual=await readPdfDocument(new Uint8Array(readFileSync(new URL(row.pdf,root))));
    assert.equal(actual.pageCount,1);verifyOffsets(actual);
    assert.ok(actual.text.length>100);
    assert.ok(actual.lines.some(line=>/80,000/.test(line.text)));
  });
}
test('actual Kestrel card PDF keeps principal, duration and rate separate; decorative glyphs are recorded',async()=>{
  const actual=await readPdfDocument(new Uint8Array(readFileSync(new URL('original/Offer_C_Kestrel_quote.pdf',root))));
  assert.ok(actual.lines.some(l=>/^You borrow €80,000$/.test(l.text)));
  assert.ok(actual.lines.some(l=>/^Over 60 months monthly repayments$/.test(l.text)));
  assert.ok(actual.lines.some(l=>/^Your rate 4\.9% per annum fixed nominal rate$/.test(l.text)));
  assert.equal(actual.decorations.length,5);
  assert.ok(!actual.text.includes('3 One-off setup'));
});
test('actual PDF page and character limits are enforced',async()=>{
  const bytes=()=>new Uint8Array(readFileSync(new URL(cases[0].pdf,root)));
  await assert.rejects(()=>readPdfDocument(bytes(),{maxPages:0}),/no more than 0 pages/);
  await assert.rejects(()=>readPdfDocument(bytes(),{maxCharacters:50}),/fewer than 50 characters/);
});
