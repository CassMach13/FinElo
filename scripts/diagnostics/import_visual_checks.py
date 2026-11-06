"""Computed presentation checks for the isolated import reference (no browser side effects)."""
import hashlib
import json
import pymupdf

AUDIT_JS=r'''() => {
 const rgba=s=>(s.match(/[\d.]+/g)||[]).map(Number);
 const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
 const bg=el=>el?blend(rgba(getComputedStyle(el).backgroundColor),bg(el.parentElement)):[255,255,255];
 const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
 const shown=el=>{if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')return false;for(let e=el;e;e=e.parentElement)if(getComputedStyle(e).opacity==='0')return false;return true};
 const layers=el=>{let opacity=1;for(let e=el;e;e=e.parentElement)opacity*=Number(getComputedStyle(e).opacity);return opacity};
 const score=(el,color)=>{
   const back=bg(el),opacity=layers(el),front=blend(rgba(color),back).map((v,i)=>v*opacity+back[i]*(1-opacity));
   let value=ratio(front,back);
   for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e),gradient=s.backgroundImage.match(/rgba?\([^)]+\)/g);
     if(gradient){value=Math.min(...gradient.map(c=>ratio(front,blend(rgba(c),bg(e.parentElement)))));break}
     if((rgba(s.backgroundColor)[3]??1)>0)break;
   }return value;
 };
 const overlay=[...document.querySelectorAll('.fixed.inset-0')].filter(el=>shown(el)&&el.querySelector('button')).at(-1);
 const tour=[...document.querySelectorAll('.driver-popover')].filter(shown).at(-1);
 const root=tour||(overlay?[...overlay.children].find(el=>el.querySelector('button'))||overlay:document.querySelector('[data-finelo-theme]')||document.querySelector('#root > div'));
 const rows=[];
 const add=(kind,text,value,threshold)=>rows.push({kind,text:String(text).slice(0,90),ratio:+value.toFixed(3),threshold,pass:value>=threshold});
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
   const node=walker.currentNode,el=node.parentElement,text=node.textContent.trim();
   // A bank's logo is a brand mark; its readable bank name is audited separately.
   if(!text||!shown(el)||el.closest('[data-finance~="brand"]')||['SCRIPT','STYLE','OPTION'].includes(el.tagName))continue;
   add('text',text,score(el,getComputedStyle(el).color),4.5);
 }
 for(const el of root.querySelectorAll('input,select,textarea')){
   if(!shown(el)||['checkbox','radio','hidden','file'].includes(el.type))continue;
   add('field',el.getAttribute('aria-label')||el.name||el.id,score(el,getComputedStyle(el).color),4.5);
   if(el.placeholder&&!el.value)add('placeholder',el.placeholder,score(el,getComputedStyle(el,'::placeholder').color),4.5);
   if(parseFloat(getComputedStyle(el).borderTopWidth)>0)add('control-border',el.name||el.id,ratio(blend(rgba(getComputedStyle(el).borderTopColor),bg(el)),bg(el)),3);
 }
 for(const el of root.querySelectorAll('button svg,[role="button"] > svg')){
   if(!shown(el)||layers(el)<.01||el.closest('[data-finance~="brand"]'))continue;
   add('action-icon',el.closest('button,[role="button"]').getAttribute('title')||'ícone',score(el,getComputedStyle(el).color),3);
 }
 const active=document.activeElement;
 for(const el of root.querySelectorAll('[data-finance~="favorite"]')){
   if(!shown(el))continue;
   const shadow=getComputedStyle(el).boxShadow.match(/rgba?\([^)]+\)/)?.[0];
   if(shadow)add('control-boundary',el.title,score(el,shadow),3);
 }
 if(root.contains(active)&&active.matches(':focus-visible')){
   const style=getComputedStyle(active);
   if(style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0)add('focus',active.name||active.getAttribute('aria-label'),ratio(rgba(style.outlineColor),bg(active.parentElement)),3);
 }
 // Opacity does not change layout or DOM content. Include laid-out opacity-zero
 // controls too: light focus can reveal a legacy hidden action without moving it.
 const elements=[root,...root.querySelectorAll('*')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&!['SCRIPT','STYLE','OPTION'].includes(el.tagName));
 const geometry=elements.map(el=>{const r=el.getBoundingClientRect();return[el.tagName,...[r.x,r.y,r.width,r.height].map(x=>+x.toFixed(3))]});
 const content=elements.map(el=>[el.tagName,[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).join(''),el.matches('input,select,textarea')?[el.value,el.checked,el.disabled]:null]);
 const colors=elements.map(el=>{const s=getComputedStyle(el);return[el.tagName,s.color,s.backgroundColor,s.backgroundImage,s.borderTopColor,s.borderRightColor,s.borderBottomColor,s.borderLeftColor,s.opacity,s.outlineColor,s.outlineStyle,s.boxShadow,s.colorScheme]});
 return {rows,geometry,content,colors};
}'''

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=True).encode()).hexdigest()

def compare_rasters(reference,actual):
    if reference==actual:return {'exact':True,'different_pixels':0,'maximum_channel_delta':0}
    a,b=pymupdf.Pixmap(reference),pymupdf.Pixmap(actual)
    assert (a.width,a.height,a.n)==(b.width,b.height,b.n),'Raster geometry differs'
    first,second=a.samples,b.samples
    maximum=max(abs(x-y) for x,y in zip(first,second))
    pixels=sum(any(first[i+c]!=second[i+c] for c in range(a.n)) for i in range(0,len(first),a.n))
    limit=max(20,int(a.width*a.height*.0001))
    assert maximum<=2 and pixels<=limit,('Visual regression',pixels,maximum,limit)
    return {'exact':False,'different_pixels':pixels,'maximum_channel_delta':maximum,'pixel_limit':limit,'classification':'bounded rasterization noise; content, geometry and computed colors checked independently'}
