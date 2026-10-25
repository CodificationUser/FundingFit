#!/usr/bin/env node
/* Assemble the supplied model and browser sources into one offline HTML file.
 * Node is a development tool only: normal use opens FundingFit.html directly. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const namespaces={
  'document_text.js':'__FF_DOCUMENT','extractor.js':'__FF_EXTRACTOR',
  'finance.js':'__FF_FINANCE','review.js':'__FF_REVIEW','pdf_reader.js':'__FF_READER',
};
function dependencies(code){
  const declarations=[];
  for(const match of code.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"];?\s*$/gm)){
    const namespace=namespaces[match[2]];
    if(!namespace)throw new Error(`Unknown source dependency: ${match[2]}`);
    declarations.push(`const {${match[1]}}=${namespace};`);
  }
  return declarations.join('\n');
}
function stripImports(code){return code.replace(/^import\s+[^\n]+\n/gm,'');}
function encapsulate(code,namespace){
  const exports=[...code.matchAll(/^export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)/gm)].map(m=>m[1]);
  for(const match of code.matchAll(/^export\s*\{([^}]+)\}\s*;/gm))exports.push(...match[1].split(',').map(x=>x.trim()).filter(Boolean));
  const returned=exports.map(x=>x.includes(' as ')?`${x.split(' as ')[1]}:${x.split(' as ')[0]}`:x).join(',');
  if(!returned)throw new Error(`No exports found in ${namespace}`);
  const deps=dependencies(code);
  code=stripImports(code).replace(/^export\s*\{[^}]+\}\s*;\s*/gm,'').replace(/^export\s+/gm,'').replace(/^\/\/# sourceMappingURL=.*$/gm,'');
  return `const ${namespace}=(()=>{\n${deps}\n${code}\nreturn {${returned}};\n})();\n`;
}
function jsonData(path){return JSON.stringify(JSON.parse(read(path))).replaceAll('<','\\u003c');}

let html=read('dist/index.html');
const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
html=html.replace('<head>',`<head>\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`);
html=html.replace('href="assets/favicon.svg"',`href="data:image/svg+xml;base64,${Buffer.from(read('dist/assets/favicon.svg')).toString('base64')}"`);
html=html.replace('<link rel="stylesheet" href="assets/style.css">',()=>`<style>${read('dist/assets/style.css')}</style>`);
html=html.replace('class="brand" href="./"','class="brand" href="#"');
const data=[['model','dist/assets/clause_model.json'],['samples','dist/data/samples.json'],['metrics','dist/data/model_metrics.json']]
  .map(([key,path])=>`<script type="application/json" id="fundingfit-${key}">${jsonData(path)}</script>`).join('\n');
const chunks=[
  '/* FundingFit offline application. Third-party licenses: dist/vendor/PDFJS-LICENSE and THIRD_PARTY_NOTICES.txt. */\n',
  encapsulate(read('dist/vendor/pdf.worker.mjs'),'__FF_PDF_WORKER'),
  'globalThis.pdfjsWorker=__FF_PDF_WORKER;\n',
  encapsulate(read('dist/vendor/pdf.mjs'),'__FF_PDF'),
];
for(const [file,namespace]of Object.entries(namespaces))chunks.push(encapsulate(read('dist/assets/'+file),namespace));
chunks.push('__FF_READER.setPdfRuntime(__FF_PDF);\n// FUNDINGFIT_APP_START\n');
chunks.push("const __FF_DATA={model:JSON.parse(document.getElementById('fundingfit-model').textContent),samples:JSON.parse(document.getElementById('fundingfit-samples').textContent),metrics:JSON.parse(document.getElementById('fundingfit-metrics').textContent)};\n");
let app=read('dist/assets/app.js');
const deps=dependencies(app);
app=stripImports(app);
const replacements=[
  ["await loadModel(new URL('./clause_model.json',import.meta.url).href)",'setModel(__FF_DATA.model)'],
  ["const response=await fetch('data/samples.json');if(!response.ok)throw new Error('Sample data unavailable');const samples=await response.json();",'const samples=__FF_DATA.samples;'],
  ["const response=await fetch('data/model_metrics.json');if(!response.ok)throw new Error('Evaluation unavailable');evaluation=await response.json();",'evaluation=__FF_DATA.metrics;'],
];
for(const [before,after]of replacements){
  if(!app.includes(before))throw new Error('Source bootstrap changed; update the standalone builder.');
  app=app.replace(before,after);
}
app=app.replace('Please reload the page or use the local launch instructions.','Close and reopen FundingFit.html, then try again.');
chunks.push(`(()=>{\n${deps}\nconst {setModel}=__FF_EXTRACTOR;\n${app}\n})();\n`);
const script=chunks.join('').replace(/<\/script/gi,'<\\/script');
const tag='<script type="module" src="assets/app.js"></script>';
if(!html.includes(tag))throw new Error('Source module bootstrap changed.');
html=html.replace(tag,()=>`${data}\n<script id="fundingfit-bundle" type="module">\n${script}</script>`);
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--output'))throw new Error('Usage: node scripts/build_standalone.mjs [--output path]');
const output=args.length?resolve(args[1]):resolve(root,'FundingFit.html');
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,html,'utf8');
console.log(`Built FundingFit.html (${Buffer.byteLength(html).toLocaleString('en')} bytes)`);
