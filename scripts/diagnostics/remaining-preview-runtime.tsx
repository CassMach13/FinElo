import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import '../../src/index.css';
import '../../src/components/appearance/appearance.css';
import '../../src/components/appearance/financial.css';
import {createRemainingFixture,REMAINING_A as A,REMAINING_B as B,remainingId} from './remaining-fixtures';

const params=new URLSearchParams(location.search),baseline=params.get('baseline');
const prefix=baseline==='main'||baseline==='reviewed'?`/scripts/diagnostics/theme-remaining-${baseline}-baseline/src`:'/src';
const load=(p:string)=>(window as any).__remainingModule(location.origin+prefix+p);
// Literal current imports share Vite's HMR URL with the mounted consumers.
// A native absolute import without the current ?t could create a second store.
const {useAppStore}=baseline==='main'||baseline==='reviewed'?await load('/hooks/useAppStore.ts'):await import('../../src/hooks/useAppStore');
const {supabase}=baseline==='main'||baseline==='reviewed'?await load('/supabaseClient.ts'):await import('../../src/supabaseClient');
const {default:MainLayout}=await load('/layouts/MainLayout.tsx'),{default:ContasView}=await load('/components/views/ContasView.tsx');
const {GlobalDialog}=await load('/components/ui/GlobalDialog.tsx'),{useDialogStore}=await load('/hooks/useDialogStore.ts');
const {default:AppearanceSessionSync}=baseline==='main'?{default:()=>null}:await load('/components/appearance/AppearanceSessionSync.tsx');
const {default:appSource}=await load('/App.tsx?raw');
const keyedRoot=appSource.includes('<MainLayout key={user?.id} />');
const fixture=createRemainingFixture(params.get('case')??'complete'),wire=(v:any)=>JSON.parse(JSON.stringify(v));
const db:any={financial_goals:wire(fixture.goals),contas:wire(fixture.accounts),transactions:wire(fixture.transactions),categories:wire(fixture.categories),budgets:wire(fixture.budgets),budget_months:[],mapping_rules:wire(fixture.mappingRules),import_configs:wire(fixture.importConfigs),import_logs:[],assets:wire(fixture.assets),family_members:wire(fixture.family),support_tickets:wire(fixture.tickets),support_messages:fixture.tickets.flatMap(t=>t.messages),subscriptions:[],investments:[],investment_portfolios:[],investment_holdings:[],economic_events:[],credit_cards:[],credit_card_statements:[],credit_card_statement_entries:[]};
const held=new Set<string>(),failures=new Set<string>(),waiting=new Map<string,Array<()=>void>>(),events:any[]=[],trace:any[]=[],authListeners=new Set<(event:string,session:any)=>void>();
let commits=0,calculations=0,sequence=1000,currentId:string|null=A;
const userFor=(id:string)=>({id,email:params.get('admin')==='true'&&id===A?'cassiomq@gmail.com':id===A?'pessoa-a@example.invalid':'pessoa-b@example.invalid',app_metadata:{appearance_pilot:id===A&&params.get('pilot')==='eligible',credit_card_engine_disabled:true,card_v2_disabled:true,atomic_imports_enabled:false,dashboard_owner_scope_disabled:true,investment_portfolios_disabled:true},user_metadata:{full_name:id===A?'Pessoa_A_QA':'Pessoa_B_QA',appearance_theme:id===A?'dark':'system',onboarding_v1_dismissed_at:'2026-01-01T12:00:00Z',terms_accepted_version:'v_2026_03_17_consumer_rights',creditCardPaymentCategory:'Pagamento Cartão'}});
const remoteUsers=new Map([[A,userFor(A)],[B,userFor(B)]]);
const actor=()=>useAppStore.getState().user?.id??null;
const session=(id:string|null=currentId)=>id?{user:wire(remoteUsers.get(id)),access_token:'synthetic-session-'+id,refresh_token:'synthetic-refresh-'+id,expires_at:4102444800}:null;
supabase.auth.getUser=async(jwt?:string)=>{const id=jwt?.startsWith('synthetic-session-')?jwt.slice('synthetic-session-'.length):currentId;return{data:{user:id?wire(remoteUsers.get(id)):null},error:null}};
supabase.auth.getSession=async()=>({data:{session:session()},error:null});
supabase.auth.onAuthStateChange=(callback:any)=>{authListeners.add(callback);return{data:{subscription:{unsubscribe:()=>authListeners.delete(callback)}}}};
supabase.auth.refreshSession=async()=>{const s=session();authListeners.forEach(cb=>cb('TOKEN_REFRESHED',s));return{data:{session:s,user:s?.user??null},error:null}};
supabase.auth.signOut=async()=>{currentId=null;authListeners.forEach(cb=>cb('SIGNED_OUT',null));return{error:null}};
supabase.auth.updateUser=async({data}:any)=>{const id=currentId;if(!id)return{data:{user:null},error:{message:'Sem sessão sintética'}};if(held.has('profile:'+id))await wait('profile:'+id);if(failures.has('profile:'+id))return{data:{user:null},error:{message:'Falha sintética de perfil'}};const next={...remoteUsers.get(id)!,user_metadata:{...remoteUsers.get(id)!.user_metadata,...data}};remoteUsers.set(id,next);return{data:{user:wire(next)},error:null}};

function wait(key:string){return new Promise<void>(resolve=>waiting.set(key,[...(waiting.get(key)??[]),resolve]))}
function filter(rows:any[],url:URL){
 let result=rows.filter(r=>[...url.searchParams].every(([k,v])=>v.startsWith('eq.')?String(r[k])===v.slice(3):v.startsWith('neq.')?String(r[k])!==v.slice(4):v.startsWith('in.(')?v.slice(4,-1).replaceAll('"','').split(',').includes(String(r[k])):v.startsWith('gte.')?String(r[k])>=v.slice(4):v.startsWith('lte.')?String(r[k])<=v.slice(4):v==='is.null'?r[k]==null:true));
 const order=url.searchParams.get('order');if(order)result=[...result].sort((a,b)=>{for(const part of order.split(',')){const[k,d]=part.split('.'),cmp=String(a[k]??'').localeCompare(String(b[k]??''));if(cmp)return d==='desc'?-cmp:cmp}return 0});
 return result.slice(Number(url.searchParams.get('offset')??0),Number(url.searchParams.get('offset')??0)+Number(url.searchParams.get('limit')??result.length));
}
const answer=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
(window as any).__remainingTransport=async(url:URL,method:string,body:any,headers:Headers)=>{
 const who=actor(),table=url.pathname.split('/').at(-1)!,isAdmin=useAppStore.getState().user?.email==='cassiomq@gmail.com';
 const key=(method==='GET'?'read:':'write:')+table;
 if(url.pathname==='/auth/v1/user'){
  const jwt=headers.get('authorization')?.replace(/^Bearer /,'')??'',id=jwt.startsWith('synthetic-session-')?jwt.slice('synthetic-session-'.length):currentId;
  if(held.has('appearance:'+id))await wait('appearance:'+id);
  if(!id||failures.has('appearance:'+id))return answer({message:'Falha sintética de preferência'},503);
  if(method==='PUT')remoteUsers.set(id,{...remoteUsers.get(id)!,user_metadata:{...remoteUsers.get(id)!.user_metadata,...body.data}});
  return answer(wire(remoteUsers.get(id)));
 }
 if(url.pathname.startsWith('/api/'))return answer({ok:true});
 if(url.pathname.includes('/rpc/')){
  const data=table==='get_admin_metrics'?{total_users:2,premium_users:1,wealth_users:1,total_revenue:0,crm_users:[{id:A,email:'contato_A_QA@example.invalid',full_name:'Contato_A_QA',created_at:'2026-01-01',last_activity_at:'2026-11-05',is_premium:true},{id:B,email:'contato_B_QA@example.invalid',full_name:'Contato_B_QA',created_at:'2026-01-01',last_activity_at:null,is_premium:false}]}:table.includes('founder')?13:table.includes('product')||table.includes('milestone')?true:[];
  if(held.has('rpc:'+table))await wait('rpc:'+table);return table==='get_admin_metrics'&&!isAdmin?answer({message:'Sem permissão'},403):answer(data);
 }
 if(url.pathname.startsWith('/storage/v1/')){
  events.push({method,path:url.pathname,body});return answer(method==='POST'&&url.pathname.includes('/sign/')?{signedURL:'/object/synthetic-attachment'}:{Key:url.pathname,Id:'synthetic-upload'});
 }
 if(!Object.hasOwn(db,table))return answer({message:'Tabela fora da referência: '+table},403);
 let source=db[table].filter((r:any)=>table==='family_members'?r.owner_id===who||r.member_email===useAppStore.getState().user?.email:table==='support_tickets'&&isAdmin?true:!r.user_id||r.user_id===who);
 if(table==='support_tickets')source=source.map((r:any)=>({...r,messages:db.support_messages.filter((m:any)=>m.ticket_id===r.id)}));
 const selected=wire(filter(source,url));
 if(held.has(key))await wait(key);
 if(failures.has(key)||params.get('case')==='load-error'&&table==='financial_goals')return answer({code:'42501',message:'Erro sintético de leitura/gravação'},403);
 if(method==='GET')return answer(headers.get('accept')?.includes('vnd.pgrst.object')?(selected[0]??null):selected);
 const denied=!who||params.get('case')==='write-error';events.push({table,method,actor:who,query:Object.fromEntries(url.searchParams),body,denied});if(denied)return answer({code:'42501',message:'Escrita sintética recusada'},403);
 if(method==='POST'){
  const made=(Array.isArray(body)?body:[body]).map(r=>({...r,id:r.id??remainingId(4,++sequence),created_at:r.created_at??'2026-11-06T12:00:00Z',updated_at:'2026-11-06T12:00:00Z'}));db[table].push(...made);return answer(headers.get('accept')?.includes('vnd.pgrst.object')?made[0]:made);
 }
 if(method==='PATCH'){
  const ids=new Set(selected.map((r:any)=>r.id??r.ID_Transacao));const changed=db[table].filter((r:any)=>ids.has(r.id??r.ID_Transacao)).map((r:any)=>Object.assign(r,body,{updated_at:'2026-11-06T12:00:00Z'}));return answer(headers.get('accept')?.includes('vnd.pgrst.object')?changed[0]:changed);
 }
 if(method==='DELETE'){const ids=new Set(selected.map((r:any)=>r.id??r.ID_Transacao));db[table]=db[table].filter((r:any)=>!ids.has(r.id??r.ID_Transacao));return answer(url.searchParams.has('select')?selected:null)}
 return answer({message:'Operação fora da referência'},403);
};

useAppStore.setState({user:wire(remoteUsers.get(A)),isWealth:true,isPremium:true,unlimitedSync:true,accounts:wire(fixture.accounts.filter(a=>a.user_id===A)),transactions:wire(fixture.transactions),transactionsUserId:A,categories:wire(fixture.categories),budgets:wire(fixture.budgets),budgetMonths:[],economicEvents:[],assets:wire(fixture.assets),mappingRules:wire(fixture.mappingRules),importConfigs:wire(fixture.importConfigs),importLogs:[],pendingInvites:[],supportTickets:[],goals:[],goalsStatus:'idle',goalsUserId:null,initialDataLoadStatus:'ready',isLoading:false,currentView:params.get('view')==='accounts'?'settings':params.get('view')??'goals',adminMetrics:null});
const originalBalance=useAppStore.getState().getAccountsWithCalculatedBalance;
useAppStore.setState({getAccountsWithCalculatedBalance:(...args:any[])=>{calculations++;return originalBalance(...args)}});
const root=createRoot(document.getElementById('root')!);
function visible(){const body=document.querySelector('#root')as HTMLElement,fields=[...body.querySelectorAll<HTMLInputElement>('input,textarea')].filter(e=>e.getClientRects().length).map(e=>e.type==='password'?'<redacted>':e.value);return{actor:actor(),view:useAppStore.getState().currentView,text:body.innerText,fields}}
function props(){const found:any[]=[];const strip=(key:string,value:any)=>key==='children'||key==='_owner'||key==='ref'||typeof value==='function'?undefined:value;function visit(f:any){if(!f)return;const name=f.type?.name??'';if(['GoalsPanel','GoalCard','GoalFormModal','UpdateGoalValueModal','AccountModal','CategoryModal','MappingRuleModal','InviteMemberModal','AssetModal','AssetDetailModal','CrudCard','BudgetModal','ImportConfigModal'].includes(name))found.push({component:name,props:f.memoizedProps});visit(f.child);visit(f.sibling)}visit((root as any)._internalRoot.current);return JSON.parse(JSON.stringify(found,strip))}
function snapshot(){const s=useAppStore.getState();return wire({scenario:fixture.scenario,actor:actor(),db,events,requests:(window as any).__remainingRequests,props:props(),visible:visible(),sources:{goals:s.goals,accounts:s.accounts,transactions:s.transactions,assets:s.assets,categories:s.categories,mappingRules:s.mappingRules,budgets:s.budgets,importConfigs:s.importConfigs,supportTickets:s.supportTickets,adminMetrics:s.adminMetrics,user:s.user?{id:s.user.id,user_metadata:s.user.user_metadata}:null}})}
(window as any).__remainingPreview={snapshot,trace:()=>trace,profile:()=>({commits,calculations,requests:(window as any).__remainingRequests.length,events:events.length}),hold:(key:string)=>held.add(key),fail:(key:string)=>failures.add(key),release:(key:string)=>{held.delete(key);failures.delete(key);const rows=waiting.get(key)??[];waiting.delete(key);rows.forEach(r=>r())},auth:(id:string|null)=>{currentId=id;useAppStore.getState().setUser(id?wire(remoteUsers.get(id)):null);if(id)useAppStore.setState({isPremium:true,isWealth:true,initialDataLoadStatus:'ready',transactionsUserId:id})},authEvent:(event:string)=>{const s=session();useAppStore.getState().setUser(s?.user??null);authListeners.forEach(cb=>cb(event,s))},updateMetadata:(data:any)=>useAppStore.getState().updateUserPreferences(data),sessionEntry:()=>({keyedRoot,prefix})};
function SessionView(){const user=useAppStore((s:any)=>s.user);if(!user)return<p role="status">Referência sem sessão autenticada.</p>;return params.get('view')==='accounts'?<ContasView key={keyedRoot?user.id:undefined}/>:<MainLayout key={keyedRoot?user.id:undefined}/>}
root.render(<BrowserRouter><div data-finelo-theme={params.get('theme')==='light'?'light':'dark'} className="min-h-screen bg-theme-canvas text-theme-content"><React.Profiler id="remaining-reference" onRender={()=>{commits++;trace.push(visible())}}><SessionView/><GlobalDialog/><AppearanceSessionSync/></React.Profiler></div></BrowserRouter>);
