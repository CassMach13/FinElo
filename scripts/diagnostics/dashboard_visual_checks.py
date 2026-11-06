from import_visual_checks import AUDIT_JS as BASE_AUDIT_JS, compare_rasters, digest
# Dashboard SVG labels are painted by fill, never the unrelated CSS color.
AUDIT_JS=BASE_AUDIT_JS.replace('score(el,getComputedStyle(el).color),4.5)',"score(el,getComputedStyle(el)[el instanceof SVGElement?'fill':'color']),4.5)")
# WCAG 1.4.3 incidental/inactive preview exemption: preserve the original premium gate.
AUDIT_JS=AUDIT_JS.replace("if(getComputedStyle(e).opacity==='0')", "if(getComputedStyle(e).opacity==='0'||getComputedStyle(e).filter.includes('blur('))")
AUDIT_JS=AUDIT_JS.replace('return {rows,geometry,content,colors};',r'''
 const svgPaint=[...root.querySelectorAll('svg *')].filter(shown).map(el=>{const s=getComputedStyle(el);return[el.tagName,el.getAttribute('d'),el.getAttribute('points'),s.fill.replace(/_r_\d+_/g,'_reactid_'),s.stroke,s.strokeWidth,s.strokeDasharray,s.stopColor,s.stopOpacity,s.fillOpacity,s.strokeOpacity,s.opacity]});
 const money=[...root.querySelectorAll('*')].flatMap(el=>[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).flatMap(n=>[...n.textContent.matchAll(/([−–-]?)\s*R\$\s*([\d.]+),([\d]{2})/g)].map(m=>({text:m[0],cents:(m[1]?-1:1)*(Number(m[2].replaceAll('.',''))*100+Number(m[3]))}))));
 for(const el of root.querySelectorAll('[data-finance~="chart-line"],[data-finance~="chart-marker"],[data-finance~="chart-legend"],[data-finance~="chart-bar"],[data-finance~="chart-focus"]:focus-visible')){
  if(!shown(el)||!el.getBoundingClientRect().width||!el.getBoundingClientRect().height)continue;
  const s=getComputedStyle(el),svg=el instanceof SVGElement;
  const color=svg?s.stroke:s.backgroundColor;
  if(color==='none'||(rgba(color)[3]??1)===0)continue;
  const back=bg(el.parentElement),alpha=(svg?Number(s.strokeOpacity):1)*layers(el);
  const front=blend(rgba(color),back).map((v,i)=>v*alpha+back[i]*(1-alpha));
  let value=ratio(front,back);
  // Hatch highlights reduce the essential bar's effective contrast as well.
  for(const highlight of s.backgroundImage.match(/rgba?\([^)]+\)/g)||[])value=Math.min(value,ratio(blend(rgba(highlight),front),back));
  add('chart-essential',el.getAttribute('data-finance'),value,3);
 }
 return {rows,geometry,content,colors,svgPaint,money};''')
