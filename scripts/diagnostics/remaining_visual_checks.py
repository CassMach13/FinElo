"""Reuse the reviewed computed audit and raster tolerance, redacting secret fields."""
from investment_visual_checks import AUDIT_JS as INVESTMENT,compare_rasters,digest
AUDIT_JS=INVESTMENT.replace("[el.value,el.checked,el.disabled]", "[(el.type==='password'||/pin|password|senha/i.test((el.name||'')+(el.id||'')+(el.placeholder||'')))?'<redacted>':el.value,el.checked,el.disabled]")

AUDIT_JS=AUDIT_JS.replace('return {rows,geometry,content,colors,svgPaint,money};',"for(const el of root.querySelectorAll('[data-finance~=remaining-toggle-thumb]')){if(shown(el))add('toggle-thumb','Cobrança mensal',ratio(blend(rgba(getComputedStyle(el).backgroundColor),bg(el.parentElement)),bg(el.parentElement)),3);} return {rows,geometry,content,colors,svgPaint,money};")
