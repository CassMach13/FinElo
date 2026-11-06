if(!import.meta.env.DEV||import.meta.env.MODE!=='staging')throw Error('Referência local de staging apenas.');
const storage=()=>{const values=new Map<string,string>();return{get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,String(v));},removeItem:(k:string)=>{values.delete(k);},clear:()=>values.clear()};};
Object.defineProperty(window,'localStorage',{value:storage()});Object.defineProperty(window,'sessionStorage',{value:storage()});Object.defineProperty(window,'BroadcastChannel',{value:undefined});
(window as any).__dashboardRequests=[];
const local=fetch.bind(globalThis);
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(url.origin===location.origin&&!url.pathname.startsWith('/api/'))return local(input,init);
 const method=init?.method??(input instanceof Request?input.method:'GET'),raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
 const body=raw?JSON.parse(raw):null,query=Object.fromEntries([...url.searchParams].filter(([k])=>!/token|apikey|authorization|secret/i.test(k)));
 (window as any).__dashboardRequests.push({path:url.pathname,method,query,body});
 const transport=(window as any).__dashboardTransport;
 return transport?transport(url,method,body,new Headers(init?.headers??(input instanceof Request?input.headers:undefined))):new Response(JSON.stringify({error:'Transporte remoto fechado'}),{status:403,headers:{'content-type':'application/json'}});
};
await import('./dashboard-preview-runtime');
