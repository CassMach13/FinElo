import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const source=readFileSync('scripts/diagnostics/pwa-r2b/worker.js','utf8').replaceAll('__BUILD__','a');
const hash=(path:string)=>createHash('sha256').update(readFileSync(path,'utf8').replaceAll('\r\n','\n')).digest('hex');
function worker(extraClients:any[]=[]){
  const handlers:Record<string,Function>={},messages:any[]=[],requests:string[]=[];
  let activations=0,serial=0;
  const owner={id:'owner',type:'window',url:'https://lab.invalid/',postMessage:vi.fn()};
  const clients=[owner,...extraClients];
  const self={location:{origin:'https://lab.invalid'},clients:{get:async()=>owner,matchAll:async()=>clients},
    addEventListener:(name:string,fn:Function)=>{handlers[name]=fn;},
    skipWaiting:()=>{activations++;}};
  const cache={addAll:async(urls:string[])=>requests.push(...urls),match:async(path:string)=>new Response('cached:'+path)};
  const context=vm.createContext({self,globalThis:null,crypto:{randomUUID:()=>String(++serial)},URL,Response,Date,Promise,
    MessageChannel,Map,Set,setTimeout,clearTimeout,caches:{open:async()=>cache}});
  // Worker globalThis is its own realm, as in a browser service worker.
  vm.runInContext('globalThis=this',context);vm.runInContext(source,context);
  return {
    activations:()=>activations,requests,
    async message(type:string){
      let done=Promise.resolve();
      handlers.message({data:{protocol:'FINELO_R2B_1',requestId:'request',type},source:owner,
        ports:[{postMessage:(value:any)=>messages.push(value)}],waitUntil:(p:Promise<void>)=>{done=p;}});
      await done;return messages;
    },
    async install(){let done=Promise.resolve();handlers.install({waitUntil:(p:Promise<void>)=>{done=p;}});await done;},
    fetch(path:string,mode='cors'){
      let result:Promise<Response>|undefined;
      handlers.fetch({request:{url:'https://lab.invalid'+path,mode,method:'POST'},respondWith:(p:Promise<Response>)=>{result=p;}});
      return result;
    },
  };
}
afterEach(()=>vi.useRealTimers());
describe('R2B isolation and actual prototype worker boundaries — not full protocol approval',()=>{
  it('keeps the authorized product configuration and legacy UI sealed',()=>{
    expect(hash('vite.config.ts')).toBe('fe3eb352f4d8a98a0ae4912f93224992c091ad9d4670f6639b66c26143f0412b');
    expect(hash('src/components/pwa/ReloadPrompt.tsx')).toBe('b9aee0ed818acb214d29112452ca4b66456ca0a2a826dc7f69d9ed4650573b6f');
  });
  it('does not let the legacy activation message activate the prototype worker',async()=>{
    const instance=worker();await instance.message('SKIP_WAITING');expect(instance.activations()).toBe(0);
  });
  it('installs only immutable presentation resources, never financial responses',async()=>{
    const instance=worker();await instance.install();
    expect(instance.requests).toEqual(['/v/a/index.html','/v/a/client.js','/v/a/style.css','/v/a/marker.svg']);
    expect(instance.activations()).toBe(0);
  });
  it.each(['/api/operation','/api/result?id=one','/api/balance?actor=QA-A'])('leaves %s to the original network transport',path=>{
    expect(worker().fetch(path)).toBeUndefined();
  });
  it('rejects an asset from a different build rather than falling back across versions',async()=>{
    const response=await worker().fetch('/v/b/client.js');expect(response?.status).toBe(409);
  });
  it('serves the document pinned to its own build',async()=>{
    const response=await worker().fetch('/','navigate');expect(await response?.text()).toBe('cached:/v/a/index.html');
  });
  it('rejects an unknown worker client even if all windows looked idle',async()=>{
    const instance=worker([{id:'background',type:'worker',postMessage:vi.fn()}]);
    expect(await instance.message('BEGIN')).toMatchObject([{status:'BLOCKED',reason:'UNKNOWN_WORKER_CLIENT'}]);
    expect(instance.activations()).toBe(0);
  });
  it('classifies a silent legacy window as unknown, never as consent',async()=>{
    vi.useFakeTimers();const instance=worker();const result=instance.message('BEGIN');
    await vi.advanceTimersByTimeAsync(700);
    expect(await result).toMatchObject([{status:'BLOCKED',reason:'NO_RESPONSE'}]);expect(instance.activations()).toBe(0);
  });
});
