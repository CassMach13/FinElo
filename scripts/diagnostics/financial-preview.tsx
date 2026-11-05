// A development-only, synthetic presentation harness. It is not an application route or build entry.
if (!import.meta.env.DEV || import.meta.env.MODE !== 'staging') throw new Error('Referência disponível apenas no servidor local em modo staging.');

const memoryStorage = () => {
  const values = new Map<string,string>();
  return {get length(){return values.size;},key:(index:number)=>[...values.keys()][index]??null,
    getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,String(value));},
    removeItem:(key:string)=>{values.delete(key);},clear:()=>values.clear()};
};
// Do not read, erase or write the application's real Auth, filter or draft storage.
Object.defineProperty(window,'localStorage',{value:memoryStorage()});
Object.defineProperty(window,'sessionStorage',{value:memoryStorage()});
Object.defineProperty(window,'BroadcastChannel',{value:undefined});

const originalFetch = globalThis.fetch.bind(globalThis);
const blocked: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin === location.origin) return originalFetch(input, init);
  // No request leaves this realm, including Auth, analytics and financial writes.
  blocked.push(url.pathname);
  if (url.pathname.endsWith('/family_members')) {
    const links=new URLSearchParams(location.search).get('family')==='true'?Array.from({length:4},(_,index)=>[
      {id:'family-'+index,owner_id:'synthetic-financial-owner',owner_email:'finance-fixture@example.invalid',member_email:`familiar${index+1}@example.invalid`,status:'accepted'},
      {id:'reciprocal-'+index,owner_id:`synthetic-financial-peer-${index}`,owner_email:`familiar${index+1}@example.invalid`,member_email:'finance-fixture@example.invalid',status:'accepted'},
    ]).flat():[];
    return new Response(JSON.stringify(links), {status:200,headers:{'content-type':'application/json'}});
  }
  return new Response(JSON.stringify({message:'Referência sem acesso remoto'}), {status:403,headers:{'content-type':'application/json'}});
};
(window as any).__financialNetworkFence = { blocked };

await import('./financial-preview-runtime');
