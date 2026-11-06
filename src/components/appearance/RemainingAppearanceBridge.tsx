import {useEffect} from 'react';
import './remaining.css';

/** Only portal paint and keyboard ownership; no store, network or financial service. */
export default function RemainingAppearanceBridge({view}:{view:string}) {
 useEffect(()=>{
  const root=document.getElementById('main-layout');if(!root)return;
  const scope=root.closest('[data-finelo-theme]');
  const marked=new Map<HTMLElement,{theme:string|null;finance:string|null}>();
  const dialogs=new Map<HTMLElement,HTMLElement|null>();
  const restore=()=>{marked.forEach((prior,node)=>{for(const[name,value]of[['data-finelo-theme',prior.theme],['data-finance',prior.finance]]){if(value===null)node.removeAttribute(name!);else node.setAttribute(name!,value!)}});marked.clear()};
  const controls=(dialog:Element)=>[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  const mark=(node:HTMLElement,role:string,theme=false)=>{if(!marked.has(node))marked.set(node,{theme:node.getAttribute('data-finelo-theme'),finance:node.getAttribute('data-finance')});if(theme)node.setAttribute('data-finelo-theme','light');node.setAttribute('data-finance',role)};
  const sync=()=>{
   for(const[dialog,anchor]of dialogs)if(!dialog.isConnected){dialogs.delete(dialog);if(anchor?.isConnected&&document.activeElement===document.body)anchor.focus()}
   root.querySelectorAll<HTMLElement>('[data-finance~="remaining-dialog"]').forEach(dialog=>{if(dialogs.has(dialog))return;dialogs.set(dialog,document.activeElement instanceof HTMLElement?document.activeElement:null);controls(dialog)[0]?.focus()});
   if(scope?.getAttribute('data-finelo-theme')!=='light'){restore();return}
   if(!['settings','help','admin'].includes(view))return;
   document.querySelectorAll<HTMLElement>('.driver-popover').forEach(portal=>{
    mark(portal,'tour',true);
    const roles:Record<string,string>={'.driver-popover-title':'content','.driver-popover-description':'muted','.driver-popover-progress-text':'muted','.driver-popover-prev-btn':'secondary','.driver-popover-next-btn':'action','.driver-popover-close-btn':'muted'};
    for(const[selector,role]of Object.entries(roles)){const node=portal.querySelector<HTMLElement>(selector);if(node)mark(node,role)}
   });
  };
  const key=(event:KeyboardEvent)=>{
   const dialog=(event.target instanceof Element?event.target.closest<HTMLElement>('[data-finance~="remaining-dialog"]'):null);if(!dialog)return;
   if(event.key==='Escape'){const cancel=[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='Cancelar');if(cancel){event.preventDefault();event.stopPropagation();cancel.click()}}
   if(event.key==='Tab'){const list=controls(dialog),first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
  };
  const observer=new MutationObserver(sync),theme=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});if(scope)theme.observe(scope,{attributes:true,attributeFilter:['data-finelo-theme']});document.addEventListener('keydown',key);sync();
  return()=>{observer.disconnect();theme.disconnect();document.removeEventListener('keydown',key);restore()};
 },[view]);
 return null;
}
