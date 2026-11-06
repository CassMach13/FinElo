import React from 'react';import{createRoot}from'react-dom/client';
import '../../src/index.css';import '../../src/components/appearance/appearance.css';import '../../src/components/appearance/financial.css';
import{createInvestmentFixture,INVESTMENT_A as A,INVESTMENT_B as B,INVESTMENT_C as C}from'./investment-fixtures';
const params=new URLSearchParams(location.search),base=params.get('baseline'),prefix=base==='main'||base==='reviewed'?`/scripts/diagnostics/theme-investments-${base}-baseline/src`:'/src';
const load=(p:string)=>(window as any).__investmentModule(location.origin+prefix+p);
const{useAppStore}=await load('/hooks/useAppStore.ts'),{supabase}=await load('/supabaseClient.ts'),{default:InvestmentsView}=await load('/components/views/InvestmentsView.tsx'),{GlobalDialog}=await load('/components/ui/GlobalDialog.tsx');
const{default:SettingsView}=await load('/components/views/SettingsView.tsx'),{default:DashboardView}=await load('/components/views/DashboardView.tsx');
const{default:entrySource}=await load('/layouts/MainLayout.tsx?raw');
const sessionGuard=entrySource.includes('investments: <InvestmentsView key={user?.id} />');
const fixture=createInvestmentFixture(params.get('case')??'complete'),v2=params.get('engine')!=='legacy',wire=(x:any)=>JSON.parse(JSON.stringify(x));
const db={investments:wire(fixture.positions),investment_portfolios:wire(fixture.portfolios),investment_holdings:wire(fixture.holdings),assets:wire(fixture.assets)};const events:any[]=[],trace:any[]=[],blocked=new Set<string>(),errors=new Set<string>(),pending=new Map<string,Array<()=>void>>();let commits=0,sequence=1000;
const userFor=(id:string)=>({id,email:id===A?'investimento-a@example.invalid':id===B?'titular-b@example.invalid':'conta-c@example.invalid',app_metadata:{investment_portfolios_enabled:v2,investment_portfolios_disabled:!v2,credit_card_engine_disabled:true,card_v2_disabled:true,atomic_imports_enabled:false,dashboard_owner_scope_enabled:true,net_worth_components_v2_enabled:true},user_metadata:{full_name:id===A?'Titular A QA':id===B?'Titular B QA':'Titular C QA',onboarding_v1_dismissed_at:'2026-01-01T12:00:00Z'}});
const actor=()=>useAppStore.getState().user?.id??null;
supabase.auth.getUser=async()=>({data:{user:useAppStore.getState().user},error:null});
const allowed=(id:string|null)=>id===A?(fixture.scenario==='denied'?[A]:[A,B]):id===B?[A,B]:id===C?[C]:[];
function filter(rows:any[],u:URL){let out=rows.filter(r=>[...u.searchParams].every(([k,v])=>v.startsWith('eq.')?String(r[k])===v.slice(3):v.startsWith('neq.')?String(r[k])!==v.slice(4):v.startsWith('in.(')?v.slice(4,-1).replaceAll('"','').split(',').includes(String(r[k])):v.startsWith('not.in.(')?!v.slice(8,-1).replaceAll('"','').split(',').includes(String(r[k])):v.startsWith('gte.')?String(r[k])>=v.slice(4):v.startsWith('lte.')?String(r[k])<=v.slice(4):v==='is.null'?r[k]==null:true));const order=u.searchParams.get('order');if(order)out=[...out].sort((a,b)=>{for(const s of order.split(',')){const[k,d]=s.split('.'),c=String(a[k]??'').localeCompare(String(b[k]??''));if(c)return d==='desc'?-c:c;}return 0});const from=Number(u.searchParams.get('offset')??0),limit=Number(u.searchParams.get('limit')??out.length);return out.slice(from,from+limit)}
const response=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const hold=(key:string)=>new Promise<void>(r=>pending.set(key,[...(pending.get(key)??[]),r]));
(window as any).__investmentTransport=async(u:URL,method:string,body:any,headers:Headers)=>{
 const table=u.pathname.split('/').at(-1)!,who=actor(),owners=allowed(who),owner=u.searchParams.get('user_id')?.replace(/^eq\./,'')??who,select=u.searchParams.get('select')??'*';
 const kind=table==='investments'?(select==='reference_month'?'latest':select==='user_id'?'discovery':u.searchParams.has('gte')||u.searchParams.get('reference_month')?.startsWith('gte.')?'history':select==='*'?'detail':'history'):table.startsWith('investment_')?'structure':table;
 const key=kind+':'+owner;
 if(u.pathname.startsWith('/api/'))return response({ok:true});
 if(u.pathname.includes('/rpc/'))return /product|milestone/.test(table)?response(true):response({message:'RPC fora da referência'},403);
 const family=who===A||who===B?fixture.scenario==='denied'?[]:fixture.family:[];
 const tables:any={...db,family_members:family,profiles:[{id:A,email:'investimento-a@example.invalid',full_name:'Titular A QA'},{id:B,email:'titular-b@example.invalid',full_name:'Titular B QA'}],transactions:[],contas:[],import_logs:[],categories:[],budgets:[],budget_months:[]};
 if(!Object.hasOwn(tables,table))return response({message:'Tabela fora da referência: '+table},403);
 if(method==='GET'){
  const source=tables[table].filter((r:any)=>!r.user_id||owners.includes(r.user_id)),rows=wire(filter(source,u));
  if(blocked.has(key))await hold(key);
  if(errors.has(key)||fixture.scenario==='load-error'&&!released.has('error'))return response({code:'42501',message:'Erro sintético de leitura'},403);
  const cols=select.split(',').map(x=>x.trim());const projected=select==='*'?rows:rows.map((r:any)=>Object.fromEntries(cols.map(k=>[k,r[k]])));
  return response(headers.get('accept')?.includes('vnd.pgrst.object')?(projected[0]??null):projected);
 }
 const target=db[table as keyof typeof db];if(!target)return response({code:'42501',message:'Escrita não autorizada'},403);
 const selected=filter(target,u),rows=method==='POST'?(Array.isArray(body)?body:[body]):selected;
 const forbidden=!who||rows.some((r:any)=>!owners.includes(r.user_id))||fixture.scenario==='read-only'||params.get('writeError')==='true';
 events.push({table,method,actor:who,body,query:Object.fromEntries(u.searchParams),denied:forbidden});
 if(forbidden)return response({code:'42501',message:'Operação recusada pela referência de autorização'},403);
 if(blocked.has('write:'+table))await hold('write:'+table);
 if(method==='POST'){
  const made=rows.map((r:any)=>({...r,id:r.id??'40000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'),created_by:who,updated_by:null,created_at:'2026-11-05T12:00:00Z',updated_at:'2026-11-05T12:00:00Z'}));target.push(...made);return response(headers.get('accept')?.includes('vnd.pgrst.object')?made[0]:made);
 }
 if(method==='PATCH'){const made=selected.map((r:any)=>Object.assign(r,body,{updated_by:who,updated_at:'2026-11-05T12:00:00Z'}));return response(headers.get('accept')?.includes('vnd.pgrst.object')?made[0]:made);}
 if(method==='DELETE'){const ids=new Set(selected.map((r:any)=>r.id));target.splice(0,target.length,...target.filter((r:any)=>!ids.has(r.id)));return response(null);}
 return response({message:'Operação fora da referência'},403);
};
const released=new Set<string>();
useAppStore.setState({user:userFor(A),isWealth:params.get('case')!=='no-entitlement',isPremium:true,assets:wire(fixture.assets),mappingRules:[],importConfigs:[],pendingInvites:[],creditCardReprocessJobs:[],creditCardShadowDashboard:[],categories:[],transactions:[],transactionsUserId:A,accounts:[],importLogs:[],budgets:[],budgetMonths:[],economicEvents:[],currentView:'investments',initialDataLoadStatus:'ready',isLoading:false,fetchAssets:async()=>{},syncAllData:async()=>{}});
const root=createRoot(document.getElementById('root')!);
function props(){const out:any[]=[];function visit(f:any){if(!f)return;const name=f.type?.name??'',p=f.memoizedProps;if(['PortfolioSummary','PortfolioHistoryChart','PortfolioAllocation','PortfolioConcentration','PortfolioMaturities','PortfolioInsightsNarrative','PortfolioShelf','InvestmentBalanceDisplay','InvestmentModal','InvestmentImportModal','PortfolioManagerDrawer','PortfolioFormModal','ClassifyInvestmentModal','AssetModal','AssetDetailModal','CurrentNetWorthPanel','NetWorthSummaryCard','CurrentNetWorthCard'].includes(name))out.push({component:name,props:p});visit(f.child);visit(f.sibling)}visit((root as any)._internalRoot.current);return wire(out)}
const monetary=new Set(['balance','total','amount','absolute','invested_principal','investedPrincipal','original_applied_amount','originalAppliedAmount','gross_return_amount','grossReturnAmount','value','remaining_balance','financed_amount','installment_value','totalBalance']);
function cents(x:any):any{if(Array.isArray(x))return x.map(cents);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,monetary.has(k)&&typeof v==='number'?Math.round(v*100):cents(v)]));return x}
function visible(){const body=document.querySelector('#root')!,text=(body as HTMLElement).innerText,fields=[...body.querySelectorAll<HTMLInputElement>('input')].filter(e=>e.getClientRects().length).map(e=>e.value);const rows:any[]=[];function visit(f:any){if(!f)return;const r=[...db.investments,...fixture.positions].find((p:any)=>p.id===f.key);if(r&&f.stateNode instanceof Element&&f.stateNode.getClientRects().length)rows.push({id:r.id,user_id:r.user_id,month:r.reference_month});visit(f.child);visit(f.sibling)}visit((root as any)._internalRoot.current);return{actor:actor(),owner:(document.getElementById('investment-owner')as HTMLSelectElement)?.value??actor(),rows,fields,dialogs:[...body.querySelectorAll<HTMLElement>('.fixed.inset-0')].filter(e=>e.getClientRects().length).map(e=>e.innerText),visibleOwnerLabels:[...fixture.portfolios,...fixture.holdings,...fixture.assets].filter((r:any)=>{const name=r.name??r.display_name;return text.includes(name)||fields.includes(name)}).map((r:any)=>({label:r.name??r.display_name,user_id:r.user_id})),visibleProductNames:[...new Set(fixture.positions.map(p=>p.product_name))].filter(name=>text.includes(name)||fields.includes(name))}}
function snapshot(){const s=useAppStore.getState(),p=props();return wire({scenario:fixture.scenario,actor:actor(),db,events,requests:(window as any).__investmentRequests,props:p,cents:cents(p),visible:visible(),source:{assets:s.assets,transactions:s.transactions,economicEvents:s.economicEvents}})}
(window as any).__investmentPreview={snapshot,sessionEntry:()=>({prefix,sessionGuard}),trace:()=>trace,profile:()=>({commits,requests:(window as any).__investmentRequests.length,events:events.length}),hold:(key:string)=>blocked.add(key),fail:(key:string)=>errors.add(key),release:(key:string)=>{released.add(key);blocked.delete(key);errors.delete(key);const q=pending.get(key)??[];pending.delete(key);q.forEach(r=>r())},auth:(id:string|null)=>{useAppStore.getState().setUser(id?userFor(id):null);if(id)useAppStore.setState({isWealth:true,isPremium:true,assets:fixture.assets.filter(a=>a.user_id===id),initialDataLoadStatus:'ready',transactionsUserId:id})}};
function SessionView(){const user=useAppStore((s:any)=>s.user);return user?params.get('view')==='assets'?<SettingsView/>:params.get('view')==='dashboard'?<DashboardView/>:<InvestmentsView key={sessionGuard?user.id:undefined}/>:<p role="status">Referência sem sessão autenticada.</p>}
root.render(<div data-finelo-theme={params.get('theme')==='light'?'light':'dark'} className="bg-theme-canvas text-theme-content min-h-screen p-4 sm:p-6"><React.Profiler id="investment-reference" onRender={()=>{commits++;trace.push(visible())}}><SessionView/><GlobalDialog/></React.Profiler></div>);
