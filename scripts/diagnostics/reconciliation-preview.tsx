// A fresh SDK instance with no real session. Install before application imports.
if(!import.meta.env.DEV||import.meta.env.MODE!=='staging')throw Error('Referência local de staging apenas.');
const storage=()=>{const values=new Map<string,string>();return{get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,String(v));},removeItem:(k:string)=>{values.delete(k);},clear:()=>values.clear()};};
Object.defineProperty(window,'localStorage',{value:storage()});
Object.defineProperty(window,'sessionStorage',{value:storage()});
Object.defineProperty(window,'BroadcastChannel',{value:undefined});
const local=fetch.bind(globalThis);
(window as any).__reconciliationRequests=[];
(window as any).__cardRequests=(window as any).__reconciliationRequests;
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(url.origin===location.origin&&!url.pathname.startsWith('/api/'))return local(input,init);
 const method=init?.method??(input instanceof Request?input.method:'GET');
 const raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
 const body=raw?JSON.parse(raw):null;
 const query=Object.fromEntries([...url.searchParams].filter(([key])=>!/token|apikey|authorization|secret/i.test(key)));
 (window as any).__reconciliationRequests.push({path:url.pathname,query,method,body});
 const transport=(window as any).__reconciliationTransport;
 return transport?transport(url,method,body,new Headers(init?.headers??(input instanceof Request?input.headers:undefined))):new Response(JSON.stringify({error:'Rede remota bloqueada'}),{status:403,headers:{'content-type':'application/json'}});
};
await import('./reconciliation-preview-runtime');
