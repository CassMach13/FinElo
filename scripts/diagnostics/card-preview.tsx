// Install the fence before importing the application. No SDK session is created.
if(!import.meta.env.DEV||import.meta.env.MODE!=='staging')throw Error('Referência local de staging apenas.');
const memoryStorage=()=>{
 const values=new Map<string,string>();
 return{get length(){return values.size;},key:(index:number)=>[...values.keys()][index]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,String(value));},removeItem:(key:string)=>{values.delete(key);},clear:()=>values.clear()};
};
Object.defineProperty(window,'localStorage',{value:memoryStorage()});
Object.defineProperty(window,'sessionStorage',{value:memoryStorage()});
Object.defineProperty(window,'BroadcastChannel',{value:undefined});
const localFetch=globalThis.fetch.bind(globalThis);
(window as any).__cardRequests=[];
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin);
 if(url.origin===location.origin&&!url.pathname.startsWith('/api/'))return localFetch(input,init);
 const method=init?.method??(input instanceof Request?input.method:'GET');
 const text=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
 const body=text?JSON.parse(text):null;
 const query=Object.fromEntries([...url.searchParams].filter(([key])=>!/token|apikey|authorization|secret/i.test(key)));
 (window as any).__cardRequests.push({path:url.pathname,query,method,body});
 const transport=(window as any).__cardTransport;
 if(transport)return transport(url,method,body,new Headers(init?.headers??(input instanceof Request?input.headers:undefined)));
 return new Response(JSON.stringify({message:'Referência sem acesso remoto'}),{status:403,headers:{'content-type':'application/json'}});
};
await import('./card-preview-runtime');
