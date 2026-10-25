/* Bounded clause reconstruction; every evidence span refers to imported text. */
const LABEL=/^(?:(?:loan|facility|credit|principal|borrowing|financing)\s+(?:amount|principal)|amount(?:\s+of\s+the\s+loan)?|principal|you borrow|over|duration|term|tenor|repayment term|interest rate|your rate|your nominal annual interest rate|your annual interest rate|(?:annual|nominal|annual nominal|nominal annual) (?:interest )?rate|rate type|interest type|currency|denomination|(?:(?:one-off |one-time )?(?:upfront |arrangement |valuation |setup |origination |application |file handling ))?fees?|other (?:fees|costs|charges)|additional costs|repayment(?: profile)?|fee payment)\s*[:\-–—]?$/i;
const NEW_FIELD=/^(?:(?:the )?(?:loan|facility|principal|credit|repayment|interest|upfront|arrangement|valuation|currency|other costs|other charges|additional costs|fee payment)|you (?:borrow|repay)|your (?:rate|fixed)|(?:a|an) (?:arrangement|application|setup|annual|mandatory|insurance|one-off)|no (?:other|additional)|there (?:are|is) no|subject:|article\s+\d+|conditions? precedent)/i;
const HEADER=/^Article\s+\d+\s*[-–—:]\s*[^\d%€$£]+$/i;
const BOILERPLATE=/^(?:fictional document|.*\|\s*page\s+\d+|our reference|contract no\.|quote\s*#|date:|issued:|borrower:|attn:|yours sincerely|dear\s|for the lender|for the borrower|accepted for)/i;
export function reconstructClauses(text,layoutLines=[]){
 const lines=[],metadata=new Map(layoutLines.map(r=>[r.start,r]));let offset=0,number=0;
 for(const raw of text.match(/[^\n]*\n|[^\n]+$/g)||[]){number++;const value=raw.trim(),start=offset+(value?raw.indexOf(value):0);offset+=raw.length;if(value){const meta=metadata.get(start)||{};lines.push({text:value,start,end:start+value.length,line:number,page:meta.page??null,boxes:meta.boxes||[],block:meta.block??null,column:meta.column??null,y:meta.y??null,height:meta.height||10});}}
 const groups=[];
 for(const row of lines){if(!groups.length){groups.push([row]);continue;}
  const group=groups.at(-1),previous=group.at(-1),previousText=group.map(r=>r.text).join(' ');
  const heading=LABEL.test(previousText),notBoundary=!BOILERPLATE.test(row.text)&&!HEADER.test(row.text)&&!LABEL.test(row.text);
  const continuation=!/[.!?]\s*$/.test(previous.text)&&(!NEW_FIELD.test(row.text)||/^principal[.]?$/i.test(row.text));
  const join=row.line===previous.line+1&&previous.page===row.page&&previous.block===row.block&&(previous.column===null||row.column===null||Math.abs(previous.column-row.column)<=15)&&(previous.y===null||row.y===null||Math.abs(previous.y-row.y)<=Math.max(22,2*Math.max(previous.height,row.height)))&&notBoundary&&(heading||continuation)&&!HEADER.test(previousText)&&!BOILERPLATE.test(previousText)&&group.length<6&&previousText.length+row.text.length<900;
  if(join)group.push(row);else groups.push([row]);
 }
 const result=[];
 for(const group of groups){let logical='';const positions=[];
  for(const row of group){if(logical){logical+=' ';positions.push(row.start-1);}for(let i=0;i<row.text.length;i++){logical+=row.text[i];positions.push(row.start+i);}}
  const boundaries=[0,...[...logical.matchAll(/(?<=[.!?])\s+(?=[A-Z])/g)].map(m=>m.index+m[0].length),logical.length];
  for(let j=0;j<boundaries.length-1;j++){let left=boundaries[j],right=boundaries[j+1];const raw=logical.slice(left,right),fragment=raw.trim();if(!fragment)continue;left+=raw.length-raw.trimStart().length;right=left+fragment.length;
   const start=positions[left],end=positions[right-1]+1,segments=[];
   for(const row of group){const a=Math.max(start,row.start),b=Math.min(end,row.end);if(a<b)segments.push({start:a,end:b,text:text.slice(a,b),line:row.line,page:row.page,boxes:row.boxes});}
   result.push({text:fragment,source:text.slice(start,end),line:segments[0].line,page:segments[0].page,span:{start,end},segments,heading:HEADER.test(fragment),boilerplate:BOILERPLATE.test(fragment)});
  }
 }
 return result;
}
