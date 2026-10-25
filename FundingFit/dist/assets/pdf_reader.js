/* Position-aware, local PDF text extraction using the bundled Mozilla PDF.js.
 * Geometry associates explicit label/value cells; it never supplies a value or
 * infers a missing financial condition. Canvas/OCR are not used. */

let suppliedPdfRuntime=null;
/** Supply the bundled namespace when running the self-contained local file. */
export function setPdfRuntime(runtime){
  if(!runtime||typeof runtime.getDocument!=='function')throw new Error('A valid local PDF runtime is required.');
  suppliedPdfRuntime=runtime;
}

const LABELS = [
  ['principal', /^(?:you borrow|loan amount|facility amount|amount(?: of (?:the )?loan)?|principal(?: amount)?|borrowed principal)$/i],
  ['term_months', /^(?:over|duration|loan duration|repayment term|term(?: to maturity)?|tenor)$/i],
  ['annual_rate_pct', /^(?:your rate|(?:your )?interest rate|(?:your )?annual (?:nominal )?(?:interest )?rate|(?:your )?nominal annual (?:interest )?rate|rate)$/i],
  ['rate_type', /^(?:rate type|interest type|rate category|interest basis)$/i],
  ['repayment_profile', /^(?:repayment profile|repayment|repayment method|repayment structure)$/i],
  ['fee_payment', /^(?:fee settlement|fee payment|payment of fees)$/i],
  ['currency', /^(?:currency|loan currency|denomination)$/i],
  ['other_costs', /^(?:other|additional|ancillary|extra) (?:costs?|fees?|charges?)$/i],
  ['upfront_fee', /^(?:(?:upfront|arrangement|origination|setup|valuation|application|processing|administration|opening|establishment|one.off|file handling)\s+)*(?:fees?|charges?|costs?)$/i],
];
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
function labelKind(value) {
  const label=clean(value).replace(/[:=]\s*$/, '');
  return LABELS.find(([, pattern]) => pattern.test(label))?.[0] ?? null;
}
function plausibleValue(kind, value) {
  if(kind==='repayment_profile') return /\b(?:monthly|instalments?|installments?|equal|amortising|amortizing)\b/i.test(value);
  if(kind==='fee_payment') return /\b(?:paid|payable|separately|financed|withheld|drawdown)\b/i.test(value);
  if(kind==='rate_type') return /\b(?:fixed|variable|floating|adjustable)\b/i.test(value);
  if(kind==='currency') return /\b(?:EUR|USD|GBP|euro|dollars?|pounds?)\b|[€$£]/i.test(value);
  if(kind==='other_costs'||kind==='upfront_fee') return /\d|\b(?:none|nil|zero|waived|missing|unknown|not specified)\b/i.test(value);
  if(kind==='annual_rate_pct') return /\d[\d.,]*\s*%/.test(value);
  return /\d/.test(value);
}
function boxOf(item, index, styles) {
  const matrix=item.transform;
  if(!Array.isArray(matrix)||matrix.length<6||!Number.isFinite(matrix[4])||!Number.isFinite(matrix[5])) return null;
  const height=Math.abs(Number(item.height))||Math.hypot(matrix[2],matrix[3])||10;
  return {text:clean(item.str),x:Number(matrix[4]),y:Number(matrix[5]),width:Math.abs(Number(item.width))||0,height,
    itemIndex:index,font:item.fontName??null,invalidFontMetrics:styles[item.fontName] ? !Number.isFinite(styles[item.fontName].ascent) : false,
    rotated:Math.abs(matrix[1])>0.01||Math.abs(matrix[2])>0.01};
}
function publicBox(box) {
  return {text:box.text,x:box.x,y:box.y,width:box.width,height:box.height,itemIndex:box.itemIndex,font:box.font};
}
function makeLine(cells,page,block,association=null) {
  const boxes=cells.flatMap(c=>c.boxes);
  return {text:cells.map(c=>c.text).join(' '),page,boxes:boxes.map(publicBox),block,
    column:cells[0]?.x??0,y:boxes[0]?.y??0,height:Math.max(...boxes.map(b=>b.height),1),
    ...(association?{association}:{})};
}
function makeCells(boxes) {
  const cells=[];
  for(const box of boxes.sort((a,b)=>a.x-b.x||a.itemIndex-b.itemIndex)) {
    const last=cells.at(-1),gap=last?box.x-last.right:Infinity;
    if(last&&gap>=-Math.max(2,.25*Math.min(box.height,last.height))&&gap<=Math.max(20,2.5*Math.min(box.height,last.height))) {
      const prior=last.boxes.at(-1);
      // Tight fragments can be portions of one word; otherwise preserve a space.
      const separator=gap>Math.max(.4,Math.min(prior.height,box.height)*.08)?' ':'';
      last.text+=separator+box.text;
      last.boxes.push(box);last.right=Math.max(last.right,box.x+box.width);last.height=Math.max(last.height,box.height);
    } else cells.push({text:box.text,x:box.x,right:box.x+box.width,height:box.height,boxes:[box]});
  }
  return cells;
}

/** Reconstruct one page from real PDF.js TextContent items and their positions.
 * Returned boxes use the original PDF coordinate system (origin bottom left).
 * Decorative invalid-font glyphs are recorded, never interpreted as amounts. */
export function reconstructPage(items,page=1,{styles={}}={}) {
  const boxes=items.map((item,index)=>boxOf(item,index,styles)).filter(b=>b?.text);
  const warnings=[],decorations=[];
  if(boxes.some(b=>b.rotated)) warnings.push(`Page ${page}: rotated text is not supported; use a horizontal text extract.`);
  const rows=[];
  for(const box of boxes.sort((a,b)=>b.y-a.y||a.x-b.x||a.itemIndex-b.itemIndex)) {
    const row=rows.find(r=>Math.abs(r.y-box.y)<=Math.max(1.5,Math.min(r.height,box.height)*.25));
    if(row){row.boxes.push(box);row.height=Math.max(row.height,box.height);}else rows.push({y:box.y,height:box.height,boxes:[box]});
  }
  rows.sort((a,b)=>b.y-a.y);
  // Some unembedded dingbat fonts map a visual checkmark to "3". Exclude only
  // a repeated leading glyph from invalid-metric fonts, with a real text item
  // alongside it. Genuine amounts and ordinary numbered lists remain intact.
  const repeated=new Map();
  for(const row of rows){row.boxes.sort((a,b)=>a.x-b.x);const first=row.boxes[0];
    if(first?.invalidFontMetrics&&first.text.length===1&&row.boxes.some(b=>b.x>first.x+first.width&&b.text.length>3)){
      const key=`${first.font}|${Math.round(first.x)}|${first.text}`;repeated.set(key,(repeated.get(key)||0)+1);
    }
  }
  for(const row of rows){const first=row.boxes[0];const key=first?`${first.font}|${Math.round(first.x)}|${first.text}`:'';
    if(first?.invalidFontMetrics&&first.text.length===1&&(repeated.get(key)||0)>=3){decorations.push({...publicBox(first),page,reason:'repeated leading decorative glyph from an invalid-metric font'});row.boxes.shift();}
    row.cells=makeCells(row.boxes);
  }
  const lines=[];
  for(let i=0;i<rows.length;i++) {
    const row=rows[i],cells=row.cells;if(!cells.length)continue;
    const kinds=cells.map(c=>labelKind(c.text));
    // A card band has multiple explicit headings and corresponding values in
    // the next visual row. The value must align with its own heading; no
    // nearest-number guessing and no crossing a page or column boundary.
    if(cells.length>=2&&kinds.every(Boolean)&&rows[i+1]&&row.y-rows[i+1].y<=45) {
      const next=rows[i+1];
      const matched=cells.map((cell,j)=>next.cells.filter(value=>Math.abs(value.x-cell.x)<=Math.max(12,cell.height)&&plausibleValue(kinds[j],value.text)));
      if(matched.every(values=>values.length===1)&&new Set(matched.map(values=>values[0])).size===cells.length&&next.cells.length===cells.length) {
        const groups=cells.map((cell,j)=>[cell,matched[j][0]]);let end=i+1;
        for(let k=i+2;k<rows.length&&k<=i+3;k++) {
          const follow=rows[k];if(rows[k-1].y-follow.y>26)break;
          const assignment=follow.cells.map(cell=>cells.findIndex(head=>Math.abs(head.x-cell.x)<=12));
          if(assignment.some(x=>x<0)||follow.cells.some(cell=>labelKind(cell.text)))break;
          assignment.forEach((index,j)=>groups[index].push(follow.cells[j]));end=k;
        }
        groups.forEach((group,j)=>lines.push(makeLine(group,page,`p${page}-cards-${i}-c${j}`,{type:'aligned_column',label:cells[j].text,fieldHint:kinds[j]})));
        i=end;continue;
      }
      warnings.push(`Page ${page}: a label/value column band was ambiguous and was kept separate.`);
    }
    // An explicit label on the left and one compatible cell on the same row
    // form a table entry. Generic two-column prose is kept in separate blocks.
    if(cells.length===2&&kinds[0]&&!kinds[1]&&plausibleValue(kinds[0],cells[1].text)) {
      const group=[...cells];let end=i;
      for(let k=i+1;k<rows.length&&k<=i+3;k++) {
        const follow=rows[k];
        if(rows[k-1].y-follow.y>20||follow.cells.length!==1||Math.abs(follow.cells[0].x-cells[1].x)>12||labelKind(follow.cells[0].text))break;
        group.push(follow.cells[0]);end=k;
      }
      lines.push(makeLine(group,page,`p${page}-table-${i}`,{type:'same_row',label:cells[0].text,fieldHint:kinds[0]}));i=end;continue;
    }
    cells.forEach((cell,j)=>lines.push(makeLine([cell],page,cells.length===1?`p${page}-flow`:`p${page}-separate-${i}-${j}`)));
  }
  return {lines,warnings,decorations};
}

/** Read an unencrypted text PDF, fully locally, with a bounded reproducible
 * layout pass. Metadata offsets refer exactly to the returned canonical text. */
export async function readPdfDocument(arrayBuffer,{maxPages=10,maxCharacters=30000}={}) {
  const pdfjs=suppliedPdfRuntime||await import('../vendor/pdf.mjs');
  if(!suppliedPdfRuntime)pdfjs.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdf.worker.mjs',import.meta.url).href;
  const input=arrayBuffer instanceof Uint8Array?new Uint8Array(arrayBuffer):new Uint8Array(arrayBuffer);
  const loading=pdfjs.getDocument({data:input,isEvalSupported:false,useSystemFonts:false,verbosity:0});
  const pdf=await loading.promise;
  const lines=[],warnings=[],decorations=[];
  try {
    if(pdf.numPages>maxPages)throw new Error(`Use a selected excerpt of no more than ${maxPages} pages.`);
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
      const page=await pdf.getPage(pageNumber),content=await page.getTextContent();
      const reconstructed=reconstructPage(content.items,pageNumber,{styles:content.styles});
      lines.push(...reconstructed.lines);warnings.push(...reconstructed.warnings);decorations.push(...reconstructed.decorations);
    }
    let text='';
    for(const line of lines){line.start=text.length;text+=line.text;line.end=text.length;text+='\n';}
    if(text.trim().length<30)throw new Error('No usable text was found. Scanned PDF images require text extraction first.');
    if(text.length>maxCharacters)throw new Error(`Use an excerpt of fewer than ${maxCharacters.toLocaleString('en-US')} characters.`);
    return {text,lines,warnings:[...new Set(warnings)],decorations,pageCount:pdf.numPages,layoutVersion:'position-aware-1'};
  } finally {await pdf.destroy();}
}
