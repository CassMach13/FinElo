import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/appearance/appearance.css';
import {createCardFixture,CARD_QA_ID,CARD_QA_OWNER} from './card-fixtures';

const params=new URLSearchParams(location.search),baseline=params.get('baseline'),engine=params.get('engine')??'legacy';
const prefix=baseline==='main'||baseline==='reviewed'?`/scripts/diagnostics/theme-card-${baseline}-baseline/src`:'/src';
const load=(path:string)=>(window as any).__cardNativeModule(new URL(prefix+path,location.origin).href);
const {useAppStore}=await load('/hooks/useAppStore.ts');
const {supabase}=await load('/supabaseClient.ts');
const {GlobalDialog}=await load('/components/ui/GlobalDialog.tsx');
const {default:TransactionsView}=await load('/components/views/TransactionsView.tsx');
const {default:CreditCardInvoiceCyclesModal}=await load('/components/modals/CreditCardInvoiceCyclesModal.tsx');
const {default:CardDiagnosticsModal}=await load('/components/modals/CardDiagnosticsModal.tsx');
const {default:AccountBalanceCard}=await load('/components/transactions/AccountBalanceCard.tsx');
const {default:CompetenceInvoiceBarChart}=await load('/components/charts/CompetenceInvoiceBarChart.tsx');
const {computeAccountCardDisplay}=await load('/components/transactions/accountBalanceCardMetrics.ts');
const {creditCardRebuildFromImportHistoryService:historyService}=await load('/services/creditCardRebuildFromImportHistoryService.ts');
const {withCanonicalEconomicBalances}=await load('/components/transactions/competenceHistoryEconomicSource.ts');
const period=await load('/utils/transactionPeriodFilters.ts');
const fixture=createCardFixture(params.get('case')??'closed');
if(params.get('funding')==='none')fixture.accounts=fixture.accounts.filter(a=>a.Tipo_Conta==='Cartão de Crédito');
if(params.get('categories')==='none')fixture.categories=[];
const wire=(value:any):any=>JSON.parse(JSON.stringify(value));
const scenario=fixture.scenario;
const events:any[]=[],pending=new Map<string,Array<()=>void>>(),released=new Set<string>(),confirmations:any[]=[],backendEvents:any[]=[];
let sequence=0,renderCommits=0,failOnce=scenario==='persist-error';
const wait=(key:string)=>new Promise<void>(resolve=>pending.set(key,[...(pending.get(key)??[]),resolve]));
const user={id:CARD_QA_OWNER,email:'card-fixture@example.invalid',user_metadata:{full_name:'Referência de cartões',creditCardPaymentCategory:'Pagamento Cartão'},app_metadata:{credit_card_engine_enabled:engine==='new',credit_card_engine_disabled:engine!=='new',card_v2_enabled:engine==='v2',card_v2_disabled:engine!=='v2',card_v2_shadow_disabled:true,atomic_imports_enabled:false}};
supabase.auth.getUser=async()=>({data:{user},error:null});
const state=()=>useAppStore.getState();
const originalGetCardStatements=state().getCardStatements;
const historyFor=(accountId:string)=>historyService.competenceHistoryCardsForAccount({accountId,account:state().accounts.find((a:any)=>a.id===accountId),accounts:state().accounts,transactions:state().transactions,importLogs:state().importLogs,userPaymentConfirmations:confirmations.filter(c=>c.account_id===accountId).map(c=>({referenceMonth:c.reference_month,settledAmount:c.settled_amount,confirmedAt:c.confirmed_at}))});
const cardRows=()=>state().accounts.filter((a:any)=>a.Tipo_Conta==='Cartão de Crédito').map((a:any)=>({id:a.id.replace(/^2/,'4'),account_id:a.id,user_id:CARD_QA_OWNER,credit_limit:a.limite_credito,closing_day:a.dia_fechamento,due_day:a.dia_vencimento}));
const statementRows=()=>cardRows().flatMap((card:any)=>historyFor(card.account_id).map((h:any,i:number)=>({id:card.id+'-'+h.referenceMonth,account_id:card.account_id,card_id:card.id,user_id:CARD_QA_OWNER,due_year:h.dueYear,due_month:h.dueMonth,due_date:h.dueDate,reference_label:h.referenceMonth,purchase_reference_label:h.referenceMonth,total_charges:h.totalDebits,total_credits:h.totalRefunds,total_payments:h.totalPayments,statement_total:h.statementTotal,open_balance:h.openBalance,open_amount:h.openBalance,status:h.openBalance<=0.005?'paid':h.dueDate<'2026-11-05'?'overdue':'open',closing_date:h.referenceMonth+'-25',created_at:'2026-11-01T12:00:00Z',atomic_projection_version:engine==='new'?1:null})));
const filterRows=(rows:any[],url:URL)=>rows.filter(row=>[...url.searchParams].every(([key,value])=>{
 if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
 if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(String(row[key]));
 return true;
}));
const response=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
(window as any).__cardTransport=async(url:URL,method:string,body:any,headers:Headers)=>{
 const resource=url.pathname.split('/').at(-1)!;
 if(resource==='credit_cards'&&method==='POST'){
  events.push({action:'existing-card-metadata-upsert',payload:wire(body)});
  const row=cardRows().find((card:any)=>card.account_id===body.account_id);
  return row?response(row):response({message:'Cartão fora da fixture'},403);
 }
 if(url.pathname.includes('/rpc/')){
  if(resource==='get_credit_card_projection_revision')return response('00000000000000000000000000000001');
  if(resource.startsWith('get_')&&resource.endsWith('_feature_state'))return response('disabled');
  if(resource.startsWith('get_latest_'))return response(null);
  return response({message:'RPC fora do diagnóstico somente leitura'},403);
 }
 if(resource==='credit_card_competence_payment_confirmations'){
  if(method==='GET'){
   if(scenario==='load-error'||scenario==='authorization-error')return response({message:scenario==='authorization-error'?'Acesso sintético não autorizado':'Falha sintética ao carregar faturas'},scenario==='authorization-error'?403:503);
   if(scenario==='loading'&&url.searchParams.get('account_id')?.startsWith('eq.')&&!released.has('confirmations'))await wait('confirmations');
  }else if(method==='POST'){
   events.push({action:'confirmation',payload:body});
   const row=Array.isArray(body)?body[0]:body;
   const found=confirmations.findIndex(c=>c.account_id===row.account_id&&c.reference_month===row.reference_month);
   if(found>=0)confirmations[found]=row;else confirmations.push(row);
   return response(null);
  }else if(method==='DELETE'){events.push({action:'undo-confirmation',query:Object.fromEntries(url.searchParams)});confirmations.splice(0,confirmations.length,...confirmations.filter(c=>!filterRows([c],url).length));return response(null);}
 }
 if(resource==='economic_events'){
  if(method==='POST'){const event={...body,id:'60000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'),user_id:CARD_QA_OWNER,status:'confirmed',created_at:'2026-11-05T12:00:00Z'};backendEvents.push(event);events.push({action:'economic-event',payload:body});return response(event);}
  if(method==='DELETE'){events.push({action:'economic-event-cleanup'});backendEvents.splice(0,backendEvents.length,...backendEvents.filter(c=>!filterRows([c],url).length));return response(null);}
 }
 const tables:Record<string,()=>any[]>={credit_cards:cardRows,credit_card_statements:statementRows,credit_card_competence_payment_confirmations:()=>confirmations,transactions:()=>state().transactions,contas:()=>state().accounts,economic_events:()=>backendEvents,credit_card_entries:()=>[],credit_card_statement_items:()=>[],credit_card_payments:()=>[],credit_card_import_lots:()=>[],credit_card_reconciliation_resolutions:()=>[],credit_card_projection_snapshots:()=>[],credit_card_payment_repair_snapshots:()=>[],credit_card_derived_settlement_snapshots:()=>[]};
 if(method==='GET'&&tables[resource]){
  const rows=filterRows(tables[resource](),url);
  return response(headers.get('accept')?.includes('vnd.pgrst.object')?(rows[0]??null):rows);
 }
 return response({message:'Operação não autorizada pela referência'},403);
};
const filters=period.getShowAllTransactionFilters();
localStorage.setItem(period.TRANSACTION_FILTERS_STORAGE_KEY,JSON.stringify(filters));
localStorage.setItem(period.SMART_TRANSACTION_FILTERS_STORAGE_KEY,JSON.stringify(filters));
localStorage.setItem(period.TRANSACTION_FILTERS_PANEL_EXPANDED_KEY,'false');
const noop=async()=>undefined;
useAppStore.setState({user,transactions:wire(fixture.rows),transactionsUserId:CARD_QA_OWNER,accounts:wire(fixture.accounts),categories:fixture.categories,assets:[],importLogs:wire(fixture.logs),mappingRules:[],economicEvents:[],isLoading:false,initialDataLoadStatus:'ready',currentView:'transactions',transactionFilters:filters,isPremium:true,isWealth:true,
 syncAllData:noop,fetchAllData:noop,fetchTransactions:noop,fetchImportLogs:noop,fetchAssets:noop,
 addTransaction:async(payload:any)=>{
  events.push({action:'add',payload:wire(payload)});
  if(failOnce){failOnce=false;throw Error('Falha sintética de persistência');}
  if(scenario==='persist-loading')await wait('persist');
  const added=(Array.isArray(payload)?payload:[payload]).map(row=>wire({...row,ID_Transacao:'30000000-0000-4000-8000-'+String(++sequence+1000).padStart(12,'0'),user_id:CARD_QA_OWNER,Origem:row.Origem??'manual'}));
  useAppStore.setState((s:any)=>({transactions:[...s.transactions,...added]}));return added;
 },
 updateTransaction:async(payload:any)=>{events.push({action:'update',payload:wire(payload)});useAppStore.setState((s:any)=>({transactions:s.transactions.map((row:any)=>row.ID_Transacao===payload.ID_Transacao?{...row,...wire(payload)}:row)}));},
 updateUserPreferences:async(payload:any)=>{events.push({action:'preferences',payload});},
 getCardStatements:async(accountId:string)=>{events.push({action:'get-statements',accountId});return originalGetCardStatements(accountId);},
 payStatement:async(id:string,payload:any)=>{events.push({action:'pay-statement',id,payload:wire(payload)});},
 getLatestAtomicCardRollback:async()=>null,getLatestAtomicCardPaymentRepairRollback:async()=>null,getLatestAtomicCardDerivedSettlementRollback:async()=>null,
 getAtomicCardRebuildFeatureState:async()=>false,getAtomicCardDerivedSettlementFeatureState:async()=>false,
 saveCardImportLotClassification:async(payload:any)=>{events.push({action:'cycle-save',payload});throw Error('Gravação de competência não é exercitada no lote visual');},
 addCategory:async(payload:any)=>{events.push({action:'category',payload});const row={...payload,id:'category-'+(++sequence)};useAppStore.setState((s:any)=>({categories:[...s.categories,row]}));return{status:'created',message:'Categoria sintética criada'};},
});
function snapshot(){
 const balances=state().getAccountsWithCalculatedBalance();
 const history=state().accounts.filter((a:any)=>a.Tipo_Conta==='Cartão de Crédito').map((a:any)=>({accountId:a.id,cards:withCanonicalEconomicBalances(historyFor(a.id))}));
 const cents=(value:any):any=>Array.isArray(value)?value.map(cents):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,typeof v==='number'&&/amount|balance|total|valor|limite|saldo|credit|debit|refund|paid|payment|charge|surplus|carry|available/i.test(key)?Math.round(v*100):cents(v)])):value;
 return wire({engine,rows:state().transactions,accounts:state().accounts,balances,history,financialCents:cents({balances,history}),confirmations,backendEvents,economicEvents:state().economicEvents,events,requests:(window as any).__cardRequests});
}
(window as any).__cardPreview={snapshot,fixture:()=>wire(fixture),profile:()=>({renderCommits,requests:(window as any).__cardRequests.length,events:events.length}),release:(key:string)=>{const waiting=pending.get(key)??[];pending.delete(key);released.add(key);waiting.forEach(resolve=>resolve());}};
const theme=params.get('theme')==='light'?'light':'dark';
function Gallery(){
 const accounts=useAppStore((s:any)=>s.accounts),transactions=useAppStore((s:any)=>s.transactions);
 return <div className="flex flex-wrap gap-4">{accounts.filter((a:any)=>a.Tipo_Conta==='Cartão de Crédito').map((account:any)=>{
  const display=computeAccountCardDisplay(account,{transactions,accounts,importLogs:state().importLogs,cardV2Enabled:engine==='v2',cardEngineEnabled:engine==='new',cardSnapshotPipelineEnabled:engine!=='legacy',creditCardMetricsReady:scenario!=='loading'});
  return <AccountBalanceCard key={account.id} account={account} display={display} onEdit={()=>events.push({action:'edit-account'})} onOpenHistory={()=>events.push({action:'history'})} onPayInvoice={()=>events.push({action:'pay'})}/>;
 })}</div>;
}
function Preview(){
 const [open,setOpen]=React.useState(true),[selected,setSelected]=React.useState('2026-10');
 const view=params.get('view');
 const display=computeAccountCardDisplay(fixture.accounts.find(a=>a.id===CARD_QA_ID),{transactions:state().transactions,accounts:state().accounts,importLogs:state().importLogs,cardV2Enabled:engine==='v2',cardEngineEnabled:engine==='new',cardSnapshotPipelineEnabled:engine!=='legacy'});
 return <div data-finelo-theme={theme} className="bg-theme-canvas text-theme-content min-h-screen p-4 sm:p-6"><React.Profiler id="card-reference" onRender={()=>{renderCommits++;}}>
  {view==='gallery'?<Gallery/>:view==='cycles'?<CreditCardInvoiceCyclesModal isOpen={open} onClose={()=>setOpen(false)} filterAccountId={params.get('all')==='true'?undefined:CARD_QA_ID}/>:view==='diagnostics'?open?<CardDiagnosticsModal accountName="Cartão Sintético QA" diagnosticos={display.diagnosticos??[]} onClose={()=>setOpen(false)} onOpenHistory={(reference:string)=>events.push({action:'history',reference})}/>:null:view==='chart'?<CompetenceInvoiceBarChart cards={historyFor(CARD_QA_ID)} selectedReferenceMonth={selected} onSelect={setSelected}/>:<TransactionsView/>}
  <GlobalDialog/>
 </React.Profiler></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
