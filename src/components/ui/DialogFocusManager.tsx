import {useEffect,useRef} from 'react';

/** Focus behavior for an existing custom dialog; renders no DOM or financial state. */
export default function DialogFocusManager({dialogId,onClose}:{dialogId:string;onClose:()=>void}){
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  const dialog=document.getElementById(dialogId);
  if(!dialog)return;
  const controls=()=>[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length>0);
  controls()[0]?.focus({preventScroll:true});
  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();}
   if(event.key!=='Tab')return;
   const nodes=controls(),first=nodes[0],last=nodes.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };
  dialog.addEventListener('keydown',onKeyDown);
  return()=>{dialog.removeEventListener('keydown',onKeyDown);if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[dialogId]);
 return null;
}
