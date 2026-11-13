import {useEffect} from 'react';

/** Portal paint and dismissible hints only; no store or service dependency. */
export default function DashboardTourAppearance(){
 useEffect(()=>{
  const dashboard=document.querySelector('[data-finance~="dashboard-view"]');
  if(!dashboard)return;
  const scope=dashboard.closest('[data-finelo-theme]');
  const hintSelector='[data-finance~="dashboard-hint-trigger"], [data-finance~="dashboard-month"]';
  const hintFor=(target:EventTarget|null)=>target instanceof Element?target.closest<HTMLElement>(hintSelector):null;
  const dismiss=(event:KeyboardEvent)=>{
   const hint=hintFor(event.target);
   if(event.key==='Escape'&&hint){hint.setAttribute('data-finance-hint-dismissed','');event.preventDefault();}
  };
  const reset=(event:Event)=>{
   const hint=hintFor(event.target),related=(event as FocusEvent|MouseEvent).relatedTarget;
   if(hint&&(!(related instanceof Node)||!hint.contains(related)))hint.removeAttribute('data-finance-hint-dismissed');
  };
  dashboard.addEventListener('keydown',dismiss as EventListener);
  dashboard.addEventListener('mouseover',reset);
  dashboard.addEventListener('focusout',reset);
  const marked=new Map<HTMLElement,{theme:string|null;finance:string|null}>();
  const restore=(node:HTMLElement,prior:{theme:string|null;finance:string|null})=>{
   for(const [name,value] of [['data-finelo-theme',prior.theme],['data-finance',prior.finance]]){
    if(value===null)node.removeAttribute(name!);else node.setAttribute(name!,value!);
   }
  };
  const paint=()=>{
   const light=scope?.getAttribute('data-finelo-theme')==='light';
   document.querySelectorAll<HTMLElement>('.driver-popover').forEach(portal=>{
    if(!light){const prior=marked.get(portal);if(prior){restore(portal,prior);marked.delete(portal);}return;}
    if(!marked.has(portal))marked.set(portal,{theme:portal.getAttribute('data-finelo-theme'),finance:portal.getAttribute('data-finance')});
    portal.setAttribute('data-finelo-theme','light');portal.setAttribute('data-finance','tour');
    const roles:Record<string,string>={'.driver-popover-title':'content','.driver-popover-description':'muted','.driver-popover-progress-text':'muted','.driver-popover-prev-btn':'secondary','.driver-popover-next-btn':'action','.driver-popover-close-btn':'muted'};
    for(const [selector,role] of Object.entries(roles))portal.querySelector(selector)?.setAttribute('data-finance',role);
   });
  };
  const portals=new MutationObserver(paint),theme=new MutationObserver(paint);
  portals.observe(document.body,{childList:true,subtree:true});if(scope)theme.observe(scope,{attributes:true,attributeFilter:['data-finelo-theme']});paint();
  return()=>{dashboard.removeEventListener('keydown',dismiss as EventListener);dashboard.removeEventListener('mouseover',reset);dashboard.removeEventListener('focusout',reset);portals.disconnect();theme.disconnect();marked.forEach((prior,node)=>{if(node.isConnected)restore(node,prior);});};
 },[]);
 return null;
}
