import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/appearance/appearance.css';
import '../../src/components/appearance/financial.css';
import {createDashboardFixture,DASHBOARD_OWNER,DASHBOARD_PEER} from './dashboard-fixtures';

const params=new URLSearchParams(location.search),baseline=params.get('baseline');
const prefix=baseline==='main'||baseline==='reviewed'?`/scripts/diagnostics/theme-dashboard-${baseline}-baseline/src`:'/src';
const load=(path:string)=>(window as any).__dashboardModule(location.origin+prefix+path);
const {useAppStore}=await load('/hooks/useAppStore.ts');
const {supabase}=await load('/supabaseClient.ts');
const {default:DashboardView}=await load('/components/views/DashboardView.tsx');
const {default:TransactionsView}=await load('/components/views/TransactionsView.tsx');
const {default:ImportView}=await load('/components/views/ImportView.tsx');
const {GlobalDialog}=await load('/components/ui/GlobalDialog.tsx');
const fixture=createDashboardFixture(params.get('case')??'complete'),events:any[]=[],released=new Set<string>(),pending=new Map<string,Array<()=>void>>();
let renderCommits=0,accountCalculations=0,sequence=0;
const wire=(v:any):any=>JSON.parse(JSON.stringify(v));
const v2=params.get('networth')!=='legacy',ownerScope=params.get('scope')!=='off';
const user={id:DASHBOARD_OWNER,email:'dashboard-fixture@example.invalid',app_metadata:{dashboard_owner_scope_enabled:ownerScope,dashboard_owner_scope_disabled:!ownerScope,net_worth_components_v2_enabled:v2,net_worth_components_v2_disabled:!v2,credit_card_engine_disabled:true,card_v2_disabled:true,card_v2_shadow_disabled:true,atomic_imports_enabled:false},user_metadata:{full_name:'Referência Dashboard QA',creditCardPaymentCategory:'Pagamento Cartão',onboarding_version:1,...(fixture.scenario.startsWith('onboarding')?{onboarding_v1_started_at:'2026-01-01T12:00:00Z'}:{onboarding_v1_dismissed_at:'2026-01-01T12:00:00Z'})}};
supabase.auth.getUser=async()=>({data:{user:useAppStore.getState().user??user},error:null});
const wait=(key:string)=>new Promise<void>(resolve=>pending.set(key,[...(pending.get(key)??[]),resolve]));
const response=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
function filter(rows:any[],url:URL){
 let result=rows.filter(row=>[...url.searchParams].every(([key,value])=>{
  if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
  if(value.startsWith('neq.'))return String(row[key])!==value.slice(4);
  if(value.startsWith('in.('))return value.slice(4,-1).replaceAll('"','').split(',').includes(String(row[key]));
  if(value.startsWith('not.in.('))return !value.slice(8,-1).replaceAll('"','').split(',').includes(String(row[key]));
  if(value.startsWith('lte.'))return String(row[key])<=value.slice(4);
  if(value.startsWith('gte.'))return String(row[key])>=value.slice(4);
  return true;
 }));
 const order=url.searchParams.get('order');
 if(order)result=[...result].sort((a,b)=>{for(const entry of order.split(',')){const [key,direction]=entry.split('.');const c=String(a[key]??'').localeCompare(String(b[key]??''));if(c)return direction==='desc'?-c:c;}return 0;});
 const from=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??result.length);
 return result.slice(from,from+limit);
}
(window as any).__dashboardTransport=async(url:URL,method:string,body:any,headers:Headers)=>{
 const resource=url.pathname.split('/').at(-1)!,state=useAppStore.getState();
 if(url.pathname.startsWith('/api/')&&/product|analytics|event/.test(url.pathname))return response({ok:true});
 if(url.pathname.includes('/rpc/')){
  if(/product|milestone/.test(resource))return response(true);
  if(/get_.*feature_state/.test(resource))return response('disabled');
  return response({message:'RPC fora da referência de Dashboard'},403);
 }
 if(resource==='investments'){
  if(fixture.scenario==='position-error'&&!released.has('position'))return response({message:'Falha sintética de leitura da posição'},503);
  if(fixture.scenario==='position-loading'&&!released.has('position'))await wait('position');
 }
 const tables:Record<string,()=>any[]>={contas:()=>state.accounts,transactions:()=>state.transactions,assets:()=>state.assets,import_logs:()=>state.importLogs,investments:()=>fixture.investments,family_members:()=>fixture.family,budgets:()=>state.budgets,budget_months:()=>state.budgetMonths,credit_card_competence_payment_confirmations:()=>[],credit_card_reconciliation_resolutions:()=>[],economic_events:()=>[],investment_portfolios:()=>[],investment_holdings:()=>[],profiles:()=>[{id:DASHBOARD_OWNER,email:user.email,full_name:user.user_metadata.full_name},{id:DASHBOARD_PEER,email:'titular-familiar-qa@example.invalid',full_name:'Titular familiar QA'}]};
 if(method==='GET'&&tables[resource]){
  const rows=filter(tables[resource](),url);return response(headers.get('accept')?.includes('vnd.pgrst.object')?(rows[0]??null):rows);
 }
 if(resource==='budget_months'&&['POST','PATCH','DELETE'].includes(method)){
  events.push({action:'budget-'+method,payload:body,query:Object.fromEntries(url.searchParams)});
  if(params.get('budgetError')==='true')return response({message:'Falha sintética ao salvar orçamento'},503);
  if(method==='POST')return response((Array.isArray(body)?body:[body]).map(row=>({...row,id:'80000000-0000-4000-8000-'+String(++sequence+100).padStart(12,'0'),created_at:'2026-11-05T12:00:00Z',updated_at:'2026-11-05T12:00:00Z'})));
  return response(null);
 }
 return response({message:'Operação fora da referência de Dashboard'},403);
};
for(const view of ['dashboard','transactions','import'])localStorage.setItem('hasSeenTour_'+view,'true');
localStorage.setItem('dashboardViewMode',params.get('period')??'monthly');
localStorage.setItem('dashboardCompareEnabled',params.get('compare')==='true'?'true':'false');
localStorage.setItem('dashboardComparePreset','previous');localStorage.setItem('dashboardCompareAnchor','2026-10-05T12:00:00Z');
const originalAccounts=useAppStore.getState().getAccountsWithCalculatedBalance;
const noop=async()=>undefined;
useAppStore.setState({user,transactions:wire(fixture.rows),transactionsUserId:DASHBOARD_OWNER,accounts:wire(fixture.accounts),categories:wire(fixture.categories),assets:wire(fixture.assets),importLogs:wire(fixture.logs),budgets:wire(fixture.budgets),budgetMonths:wire(fixture.budgetMonths),economicEvents:[],mappingRules:[],pendingInvites:fixture.scenario==='invite'?[{id:'qa-invite',owner_email:'convite-sintetico@example.invalid'}]:[],currentView:'dashboard',isLoading:fixture.scenario==='loading',initialDataLoadStatus:fixture.scenario==='loading'?'loading':fixture.scenario==='load-error'?'error':'ready',isPremium:fixture.scenario!=='free',isWealth:true,
 getAccountsWithCalculatedBalance:(...args:any[])=>{accountCalculations++;return originalAccounts(...args);},
 syncAllData:noop,fetchTransactions:noop,fetchImportLogs:noop,fetchAssets:noop,
 fetchAllData:async()=>{events.push({action:'fetchAllData'});useAppStore.setState({initialDataLoadStatus:'ready',isLoading:false});},
 updateUserPreferences:async(patch:any)=>{events.push({action:'preferences',payload:wire(patch)});useAppStore.setState((s:any)=>({user:{...s.user,user_metadata:{...s.user.user_metadata,...patch}}}));return true;},
 addTransaction:async(payload:any)=>{events.push({action:'add',payload:wire(payload)});return[];},
 addAccount:async(payload:any)=>{events.push({action:'account-add',payload});},updateAccount:async(payload:any)=>{events.push({action:'account-update',payload});},
});
const propsKeys:Record<string,string[]>={SummaryCard:['title','value','subValue','variant','compare'],NetWorthSummaryCard:['total','accounts','investments','assetsNet','assetsGross','assetsDebts','asOfLabel','primaryPeriodLabel','compare'],CurrentNetWorthCard:['position','status','scopeLabel'],AnnualEvolutionCard:['model'],AnnualEvolutionChart:['months','currentYear','previousYear'],MonthlyChangeCard:['model'],UpcomingEntriesCard:['transactions','accounts','categories','economicKindByEventId'],IncomeExpenseBar:['income','expense','tone'],CategorySpendChart:['data','compareData','primaryLabel','compareLabel'],MonthlyEvolutionChart:['data','viewMode','selectedDate','compareData','primaryPeriodData','comparePeriodData','compareSelectedDate','compareEnabled','primaryLabel','compareLabel'],Rule503020Widget:['income','operationalExpenses','savings','compare'],BudgetManagerPanel:['isOpen','initialMonth','currentMonth','currentUserId','budgets','budgetMonths','initialOwnerId'],FirstStepsCard:['phase','steps','uncategorizedCount']};
const clean=(v:any):any=>typeof v==='function'||v===undefined||React.isValidElement(v)?undefined:v instanceof Date?v.toISOString():v instanceof Map?[...v.entries()].map(([k,x])=>[k,clean(x)]):Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!k.startsWith('_')).map(([k,x])=>[k,clean(x)])):v;
const root=createRoot(document.getElementById('root')!);
function financialProps(){
 const out:any[]=[];
 const visit=(node:any)=>{if(!node)return;const name=node.type?.displayName??node.type?.name??node.elementType?.name;const keys=propsKeys[name];
  if(keys){const props:any=Object.fromEntries(keys.map(k=>[k,clean(node.memoizedProps?.[k])]));
   if(['MonthlyEvolutionChart','CategorySpendChart'].includes(name))props.computedSeries=clean(node.memoizedState?.memoizedState?.[0]);
   if(name==='Rule503020Widget')props.computedSplit=clean(node.memoizedState?.next?.memoizedState?.[0]);
   out.push({component:name,props});}
  visit(node.child);visit(node.sibling);
 };
 visit((root as any)._internalRoot.current);return wire(out);
}
function observedCents(props:any[]){
 const amount=(v:any)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*100):null;
 const fields=(row:any,keys:string[])=>Object.fromEntries(keys.map(k=>[k,amount(row?.[k])]));
 return props.map(({component,props:p})=>({component,
  ...(component==='SummaryCard'?{title:p.title,formatted:p.value}:{}),
  ...(component==='CurrentNetWorthCard'?{position:p.position,status:p.status}:{}),
  ...(component==='NetWorthSummaryCard'?{current:fields(p,['total','accounts','investments','assetsNet','assetsGross','assetsDebts']),compare:p.compare?fields(p.compare.breakdown,['total','accounts','investments','assetsNet','assetsGross','assetsDebts']):null}:{}),
  ...(component==='AnnualEvolutionCard'?{totals:fields(p.model?.totals,['incomeCurrent','incomePrevious','expenseCurrent','expensePrevious']),months:p.model?.months?.map((m:any)=>({month:m.month,...fields(m,['incomeCurrent','incomePrevious','expenseCurrent','expensePrevious'])}))}:{}),
  ...(component==='MonthlyEvolutionChart'?{series:p.computedSeries?.map((m:any)=>({name:m.name,...fields(m,['Renda','Despesa','Saldo'])}))}:{}),
  ...(component==='CategorySpendChart'?{series:p.computedSeries?.map((m:any)=>({name:m.name,...fields(m,['gasto','compareGasto'])}))}:{}),
  ...(component==='IncomeExpenseBar'?fields(p,['income','expense']):{}),
  ...(component==='Rule503020Widget'?{split:fields(p.computedSplit,['essentials','lifestyle','savings'])}:{}),
 }));
}
function snapshot(){const s=useAppStore.getState(),props=financialProps();return wire({fixture,source:{transactions:s.transactions,accounts:s.accounts,assets:s.assets,categories:s.categories,budgets:s.budgets,budgetMonths:s.budgetMonths,economicEvents:s.economicEvents,importLogs:s.importLogs},financialProps:props,financialCents:observedCents(props),events,requests:(window as any).__dashboardRequests,currentView:s.currentView});}
(window as any).__dashboardPreview={snapshot,profile:()=>({renderCommits,accountCalculations,requests:(window as any).__dashboardRequests.length,events:events.length}),release:(key:string)=>{released.add(key);const queue=pending.get(key)??[];pending.delete(key);queue.forEach(resolve=>resolve());if(key==='initial')useAppStore.setState({isLoading:false,initialDataLoadStatus:'ready'});},navigate:(view:string)=>useAppStore.getState().setCurrentView(view)};
function Preview(){const view=useAppStore((s:any)=>s.currentView);return <div data-finelo-theme={params.get('theme')==='light'?'light':'dark'} className="bg-theme-canvas text-theme-content min-h-screen p-4 sm:p-6"><nav className="mb-3 flex gap-3 print:hidden no-print" aria-label="Referência isolada"><button data-finance="secondary" onClick={()=>useAppStore.getState().setCurrentView('dashboard')}>Dashboard QA</button><button data-finance="secondary" onClick={()=>useAppStore.getState().setCurrentView('transactions')}>Transações QA</button><button data-finance="secondary" onClick={()=>useAppStore.getState().setCurrentView('import')}>Importação QA</button></nav><React.Profiler id="dashboard-reference" onRender={()=>{renderCommits++;}}>{view==='dashboard'?<DashboardView/>:view==='transactions'?<TransactionsView/>:view==='import'?<ImportView/>:<p role="status">Rota fora da referência do 4A.</p>}<GlobalDialog/></React.Profiler></div>;}
root.render(<Preview/>);
