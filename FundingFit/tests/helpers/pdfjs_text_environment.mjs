/* Node-only compatibility for PDF.js text extraction. No canvas or rendering
 * function is exercised. Modern browsers already provide DOMMatrix and toHex.
 * The matrix sentinel fails if PDF.js ever tries to render rather than only
 * constructing its otherwise-unused module-level canvas matrix. */
if(typeof globalThis.DOMMatrix==='undefined') {
  globalThis.DOMMatrix=class TextExtractionOnlyDOMMatrix {
    constructor(){this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0;}
    multiply(){throw new Error('PDF rendering is outside this text-only test environment.');}
    translate(){throw new Error('PDF rendering is outside this text-only test environment.');}
    invertSelf(){throw new Error('PDF rendering is outside this text-only test environment.');}
  };
}
if(typeof Uint8Array.prototype.toHex!=='function') {
  Object.defineProperty(Uint8Array.prototype,'toHex',{
    configurable:true,writable:true,
    value(){return Array.from(this,value=>value.toString(16).padStart(2,'0')).join('');},
  });
}
