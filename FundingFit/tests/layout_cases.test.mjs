import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {setModel,extractOffer} from '../dist/assets/extractor.js';
const base=new URL('../data/layout_examples/',import.meta.url);
setModel(JSON.parse(readFileSync(new URL('../dist/assets/clause_model.json',import.meta.url),'utf8')));
const cases=JSON.parse(readFileSync(new URL('expected_cases.json',base),'utf8')).filter(row=>row.text);
for(const row of cases){
  test(`semantic layout counterpart: ${row.id}`,()=>{
    const source=readFileSync(new URL(row.text,base),'utf8');
    const result=extractOffer(source,{id:row.id,name:row.id});
    assert.equal(result.supported,row.expected_supported,`${row.id}: ${result.issues.join('; ')}`);
    for(const [key,value] of Object.entries(row.expected_fields)){
      assert.equal(result.fields[key].value,value,`${row.id} ${key}`);
    }
    assert.equal(result.requires_user_confirmation,true);
    for(const field of Object.values(result.fields)){
      if(field.source){assert.equal(source.slice(field.span.start,field.span.end),field.source);}
      for(const segment of field.segments||[]){assert.equal(source.slice(segment.start,segment.end),segment.text);}
    }
    if(!row.expected_supported)assert.ok(result.issues.length>0);
    if(row.id==='unsupported_conflicting_rate'){
      assert.equal(result.fields.annual_rate_pct.value,null);
      assert.equal(result.fields.annual_rate_pct.status,'ambiguous');
    }
    if(row.id==='unsupported_variable')assert.notEqual(result.fields.rate_type.value,'fixed');
  });
}
for(const row of JSON.parse(readFileSync(new URL('safety_cases.json',base),'utf8'))){
  test(`layout safety: ${row.id}`,()=>{
    const result=extractOffer(row.text,{id:row.id});
    assert.equal(result.supported,row.expected_supported,`${row.id}: ${result.issues.join('; ')}`);
    for(const [key,value] of Object.entries(row.expected_fields||{}))assert.equal(result.fields[key].value,value,`${row.id} ${key}`);
    if(!row.expected_supported)assert.ok(result.issues.length>0);
    assert.equal(result.requires_user_confirmation,true);
  });
}
