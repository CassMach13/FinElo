from import_visual_checks import AUDIT_JS as BASE,compare_rasters,digest
AUDIT_JS=BASE.replace('score(el,getComputedStyle(el).color),4.5)',"score(el,getComputedStyle(el)[el instanceof SVGElement?'fill':'color']),4.5)")
AUDIT_JS=AUDIT_JS.replace('return {rows,geometry,content,colors};',r'''
 const svgPaint=[...root.querySelectorAll('svg *')].filter(e=>shown(e)||e.tagName==='stop').map(e=>{const s=getComputedStyle(e);return[e.tagName,e.getAttribute('d'),e.getAttribute('points'),s.fill.replace(/_r_[a-z0-9]+_/g,'_reactid_'),s.stroke,s.strokeWidth,s.strokeDasharray,s.stopColor,s.stopOpacity,s.fillOpacity,s.strokeOpacity,s.opacity]});
 const money=[...root.querySelectorAll('*')].flatMap(e=>[...e.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).flatMap(n=>[...n.textContent.matchAll(/([−–-]?)\s*R\$\s*([\d.]+),([\d]{2})/g)].map(m=>({text:m[0],cents:(m[1]?-1:1)*(Number(m[2].replaceAll('.',''))*100+Number(m[3]))}))));
 for(const e of root.querySelectorAll('[data-finance~="investment-chart-line"],[data-finance~="investment-chart-marker"],[data-finance~="investment-chart-point"],[data-finance~="investment-chart-focus"]:focus-visible,[data-finance~="investment-bar"]')){
  if(!shown(e)||!e.getBoundingClientRect().width||!e.getBoundingClientRect().height)continue;
  const s=getComputedStyle(e),svg=e instanceof SVGElement,color=svg?(e.matches('[data-finance~="investment-chart-point"]')?s.fill:s.stroke):s.backgroundColor;
  if(color!=='none')add('chart-essential',e.getAttribute('data-finance'),svg?score(e,color):ratio(blend(rgba(color),bg(e.parentElement)),bg(e.parentElement)),3);
 }
 return {rows,geometry,content,colors,svgPaint,money};''')
