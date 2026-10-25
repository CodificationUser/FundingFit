import './helpers/pdfjs_text_environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readPdfDocument} from '../dist/assets/pdf_reader.js';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
const root=new URL('../',import.meta.url);
setModel(JSON.parse(readFileSync(new URL('dist/assets/clause_model.json',root),'utf8')));
const cases=JSON.parse(readFileSync(new URL('data/layout_examples/expected_cases.json',root),'utf8'));
for(const row of cases){
  test(`actual PDF.js → positioned clauses → trained model → scope decision: ${row.id}`,async()=>{
    const pdf=await readPdfDocument(new Uint8Array(readFileSync(new URL('data/layout_examples/'+row.pdf,root))));
    const actual=extractOffer(pdf.text,{id:row.id,layoutLines:pdf.lines,layoutWarnings:pdf.warnings});
    for(const [key,value]of Object.entries(row.expected_fields))assert.equal(actual.fields[key].value,value,`${row.id} ${key}`);
    assert.equal(actual.supported,row.expected_supported,`${row.id}: ${actual.issues.join('; ')}`);
    assert.equal(actual.requires_user_confirmation,true);
    for(const field of Object.values(actual.fields)){
      if(field.source&&field.span)assert.equal(pdf.text.slice(field.span.start,field.span.end),field.source);
      for(const segment of field.segments??[]){assert.equal(pdf.text.slice(segment.start,segment.end),segment.text);assert.ok(segment.page>=1);}
    }
  });
}
