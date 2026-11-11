import {useEffect} from 'react';
/** DOM-only accessibility for the existing investment controls; no store or financial service. */
export default function InvestmentAppearanceBridge(){
 useEffect(()=>{
  const root=document.querySelector('[data-finance~="investment-view"]');if(!root)return;
  const initial=new Map<HTMLElement,HTMLElement|null>();let counter=0;
  const group='[data-finance~="investment-hint-trigger"],[data-finance~="investment-menu"]';
  const find=(e:EventTarget|null)=>e instanceof Element?e.closest<HTMLElement>(group):null;
  const controls=(d:Element)=>[...d.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  const sync=()=>{
   root.querySelectorAll<HTMLElement>('[data-finance~="investment-hint-trigger"]').forEach(trigger=>{const hint=trigger.querySelector<HTMLElement>('[data-finance~="investment-hint"]');if(!hint)return;if(!hint.id){let id:string;do{id='investment-hint-'+(++counter)}while(document.getElementById(id));hint.id=id;}trigger.setAttribute('aria-describedby',hint.id);});
   for(const[d,anchor]of initial)if(!d.isConnected){initial.delete(d);if(anchor?.isConnected&&document.activeElement===document.body)anchor.focus();}
   root.querySelectorAll<HTMLElement>('[data-finance~="investment-dialog"]').forEach(d=>{if(initial.has(d))return;initial.set(d,document.activeElement instanceof HTMLElement?document.activeElement:null);if(!d.hasAttribute('aria-labelledby')&&!d.hasAttribute('aria-label'))d.setAttribute('aria-label',d.querySelector('h1,h2,h3')?.textContent??'Investimento');if(!d.contains(document.activeElement)){const first=d.querySelector<HTMLElement>('input:not(:disabled):not([type=file]):not([type=hidden])')??controls(d)[0];first?.focus();}});
  };
  const reset=(event:Event)=>{const g=find(event.target),other=(event as MouseEvent|FocusEvent).relatedTarget;if(g&&(!(other instanceof Node)||!g.contains(other)))g.removeAttribute('data-finance-dismissed');};
  const key=(event:Event)=>{const e=event as KeyboardEvent,target=e.target instanceof Element?e.target:null,g=find(target)??(e.key==='Escape'?root.querySelector<HTMLElement>('[data-finance~="investment-hint-trigger"]:hover,[data-finance~="investment-menu"]:hover'):null);
   const file=target?.closest<HTMLElement>('[data-finance~="investment-file-trigger"]');if(file&&target===file&&(e.key==='Enter'||e.key===' ')){e.preventDefault();file.click();return;}
   if(e.key==='Escape'&&g){g.setAttribute('data-finance-dismissed','');if(g.matches('[data-finance~="investment-menu"]'))g.querySelector<HTMLButtonElement>('button')?.focus();e.preventDefault();e.stopPropagation();return;}
   const dialog=target?.closest<HTMLElement>('[data-finance~="investment-dialog"]');if(!dialog)return;
   if(e.key==='Escape'){const close=dialog.querySelector<HTMLButtonElement>('[data-finance-close]:not(:disabled)');if(close){e.preventDefault();e.stopPropagation();close.click();}}
   if(e.key==='Tab'){const list=controls(dialog),first=list[0],last=list.at(-1);if(!first)return;if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  };
  const observer=new MutationObserver(sync);observer.observe(root,{childList:true,subtree:true});document.addEventListener('keydown',key);root.addEventListener('mouseover',reset);root.addEventListener('focusout',reset);sync();
  return()=>{observer.disconnect();document.removeEventListener('keydown',key);root.removeEventListener('mouseover',reset);root.removeEventListener('focusout',reset);};
 },[]);return null;
}
