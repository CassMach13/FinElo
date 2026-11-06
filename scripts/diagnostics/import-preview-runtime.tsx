import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/appearance/appearance.css';
import type {Transaction,Account,ImportConfig} from '../../src/types';

const params=new URLSearchParams(location.search),variant=params.get('baseline');
const prefix=variant==='main'||variant==='reviewed'?`/scripts/diagnostics/theme-import-${variant}-baseline/src`:'/src';
const load=(path:string)=>(window as any).__importNativeModule(new URL(prefix+path,location.origin).href);
const {useAppStore}=await load('/hooks/useAppStore.ts');
const {supabase}=await load('/supabaseClient.ts');
const {GlobalDialog}=await load('/components/ui/GlobalDialog.tsx');
const {default:ImportView}=await load('/components/views/ImportView.tsx');
const {default:SettingsView}=await load('/components/views/SettingsView.tsx');
const {default:OpenFinanceReviewModal}=await load('/components/modals/OpenFinanceReviewModal.tsx');
const userId='synthetic-import-owner',scenario=params.get('case')??'default';
const user={id:userId,email:'import-fixture@example.invalid',app_metadata:{atomic_imports_enabled:false,credit_card_engine_enabled:false},user_metadata:{full_name:'Referência de importação',open_finance_enabled:params.get('integration')==='on',credit_card_engine_disabled:true,card_v2_disabled:true,card_v2_shadow_disabled:true,favoriteBankIds:['nubank-conta','cartao-xp']}};
// No SDK session or credential is created. This fake identity belongs only to this isolated module instance.
supabase.auth.getUser=async()=>({data:{user},error:null});
const accounts=[
  {id:'bank',user_id:userId,Nome_Conta:'Conta QA',Tipo_Conta:'Conta Corrente',bank_id:'nubank-conta',Saldo_Inicial:1000,Data_Saldo_Inicial:'2026-01-01'},
  {id:'wallet',user_id:userId,Nome_Conta:'Carteira QA',Tipo_Conta:'Dinheiro em Espécie',bank_id:'cash',Saldo_Inicial:50,Data_Saldo_Inicial:'2026-01-01'},
  {id:'credit',user_id:userId,Nome_Conta:'Cartão XP QA',Tipo_Conta:'Cartão de Crédito',bank_id:'cartao-xp',Saldo_Inicial:0,limite_credito:5000,dia_vencimento:20,Data_Saldo_Inicial:'2026-01-01'},
] as unknown as Account[];
const row=(id:string,name:string,value:number,extra:any={})=>({ID_Transacao:id,user_id:userId,ID_Conta:'bank',Data:'2026-11-04',Data_Pagamento:'2026-11-04',Descricao_Original:name,Nome_Fantasia:name,Valor:value,Tipo:value<0?'Despesa':'Renda',Categoria:'Outros',Origem:'Manual',Fonte:'Conta',...extra});
const transactions=[row('old-duplicate','DUPLICADA SINTETICA',-15),row('manual-income','Depósito manual',200),row('of-existing','Já sincronizada',1,{pluggy_transaction_id:'of-duplicate'}),
  row('sister-a','Sofá QA A',-120.5,{ID_Conta:'credit',Data:'2026-09-14',Data_Pagamento:'2026-10-20',Descricao_Original:'LOJA QA',Categoria:'Casa',Parcela_Atual:1,Total_Parcelas:4,import_log_id:'xp-history-a',Origem:'xp-2026-09.csv'})];
if(scenario==='e864-ambiguous')transactions.push({...transactions.at(-1),ID_Transacao:'sister-b',Nome_Fantasia:'Sofá QA B'} as any);
transactions[0].import_log_id='log-0';transactions[0].Origem='lote-sintetico.csv';
const details=[transactions[0],row('deleted','Linha excluída do ledger',-2,{Data:'2026-10-02'}),{Data:'2026-10-03',Nome_Fantasia:'Legado sem ID',Descricao_Original:'Legado',Valor:0,Categoria:'Outros'}];
let logs:any[]=Array.from({length:24},(_,i)=>({id:'log-'+i,file_name:i===0?'lote-sintetico.csv':`historico-sintetico-${String(i).padStart(2,'0')}.csv`,import_date:`2026-10-${String(25-i).padStart(2,'0')}T12:00:00Z`,total_transactions:i===0?5:1,imported_count:i===0?3:1,ignored_count:i===0?2:0,imported_details:i===0?details:[{...transactions[0],Valor:i%2?-i:i}],ignored_details:i===0?[{Data:'2026-10-02',Descricao:'Linha ignorada',Valor:-3,Motivo:'Ignorado pelo usuário'},{RawRow:'cabeçalho',Motivo:'Linha inválida'}]:[]}));
logs.push({id:'xp-history-a',file_name:'xp-2026-09.csv',import_date:'2026-10-01T12:00:00Z',total_transactions:1,imported_count:1,ignored_count:0,imported_details:[{...transactions[3],Card_Reference_Label:'2026-09',Card_Due_Date:'2026-10-20'}],ignored_details:[]});
if(params.get('plan')==='free')logs=[];
if(scenario==='quota')logs=[{...logs[0],id:'quota',file_name:'uso-gratuito.csv',import_date:'2026-11-01T12:00:00Z',imported_count:1}];
const configs=[{id:'cfg-manual',Nome_Fonte:'CSV sintético',Tipo_Fonte:'Conta',Tem_Cabecalho:true,Linhas_Ignorar_Inicio:0,Coluna_Data:'0',Coluna_Descricao_1:'1',Coluna_Valor:'2',Coluna_Parcelas:'3',Ignorar_Indices:[],ID_Conta_Associada:'bank'},
  {id:'cfg-card',Nome_Fonte:'Cartão sintético',Tipo_Fonte:'Cartao',Tem_Cabecalho:true,Linhas_Ignorar_Inicio:0,Coluna_Data:'0',Coluna_Descricao_1:'1',Coluna_Valor:'2',Coluna_Parcelas:'3',Ignorar_Indices:[],ID_Conta_Associada:'credit'}] as unknown as ImportConfig[];
const categories=['Alimentação','Casa','Outros','Renda','Transporte'].map((name,i)=>({id:'category-'+i,Nome_Categoria:name,Tipo:'Ambos'}));
const rules=[{id:'rule-1',Texto_Contido_Descricao:'MERCADO',Nome_Fantasia_Sugerido:'Mercado QA classificado',Categoria_Sugerida:'Alimentação'}];
let configRows=[...configs];
const events:any[]=[],pending=new Map<string,(value?:unknown)=>void>(),fingerprints=new Set<string>();
let sequence=0,failOnce=scenario==='persist-error'||scenario==='interrupted',reviewDelay=true;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const wire=(input:any):any=>JSON.parse(JSON.stringify(input));
let backendAccounts=wire(accounts);
const wait=(key:string)=>new Promise(resolve=>pending.set(key,resolve));
const connection={id:'connection-1',user_id:userId,item_id:'synthetic-link',bank_name:'Banco Sintético',created_at:'2026-10-01T12:00:00Z',status:'active',ID_Conta_Associada:'bank'};
const connected=params.get('connections')!=='none';
let connectionRows=connected?[connection]:[];
const financeRows=[
  {id:'of-market',date:'2026-11-04',description:'MERCADO QA',amount:31.5,type:'OUTFLOW'},
  {id:'of-income',date:'2026-11-04',description:'Depósito revisado',amount:200,type:'INFLOW',category:'INCOME'},
  {id:'of-new',date:'2026-11-03',description:'REEMBOLSO QA',amount:0,type:'INFLOW'},
  {id:'of-duplicate',date:'2026-11-02',description:'Já sincronizada',amount:1,type:'INFLOW'},
];
if(params.get('many')==='true')financeRows.push(...Array.from({length:36},(_,i)=>({id:'of-many-'+i,date:'2026-11-03',description:'Lançamento longo da integração '+i,amount:i/10,type:i%2?'OUTFLOW':'INFLOW'})));
(window as any).__importTransport=async(url:URL,method:string,body:any)=>{
  const resource=url.pathname.split('/').at(-1)!;
  if(url.pathname==='/api/belvo-consent'){
    if(scenario==='integration-loading')await wait('consent');
    if(scenario==='integration-success')return json({accessToken:'synthetic-not-a-credential'});
    return json({error:'Falha sintética ao iniciar conexão'},503);
  }
  if(url.pathname==='/api/belvo-sync'){
    if(scenario==='fetch-loading')await wait('fetch');
    if(scenario==='fetch-error')return json({error:'Falha sintética na leitura da integração'},503);
    if(scenario==='legacy-connection')return json({error:'conexao_pluggy_legada: Reconecte'},409);
    return json({transactions:scenario==='integration-empty'?[]:financeRows});
  }
  if(url.pathname.includes('/rpc/')){
    if(resource==='get_atomic_import_feature_state')return json(params.get('atomic')==='on'?'enabled':'disabled');
    if(resource==='import_transactions_scoped'||resource==='import_transactions_atomic'){
      events.push({action:'rpc-import',route:resource,payload:body});
      if(scenario==='persist-loading'||(scenario==='interrupted'&&failOnce))await wait('persist');
      if(failOnce){failOnce=false;return json({message:'Falha sintética sem gravações parciais'},503);}
      const key=body.p_account_id+':'+body.p_fingerprint;
      if(fingerprints.has(key))return json({duplicate:true,transactions:[]});
      fingerprints.add(key);
      const logId='new-log-'+(++sequence);
      const batch=body.p_transactions.map((t:any)=>({...t,ID_Transacao:'imported-'+(++sequence),import_log_id:logId}));
      const log={id:logId,file_name:body.p_file_name,import_date:'2026-11-05T12:00:00Z',total_transactions:body.p_total_transactions,imported_count:batch.length,ignored_count:body.p_ignored_details.length,ignored_details:body.p_ignored_details,imported_details:batch.map((t:any)=>({...t,...body.p_detail_context}))};
      logs=[log,...logs];
      events.push({action:'rpc-result',rows:batch,log});
      return json({duplicate:false,transactions:batch,import_log:log});
    }
    return json({message:'RPC não autorizada no diagnóstico'},403);
  }
  if(resource==='pluggy_connections'){
    if(method==='GET'){if(scenario==='connections-loading')await wait('connections');return json(connectionRows);}
    events.push({action:'connection-'+method,payload:body});
    if(method==='DELETE')connectionRows=[];
    if(method==='PATCH')connectionRows=connectionRows.map(item=>({...item,...body}));
    return json([]);
  }
  if(resource==='contas'&&method==='PATCH'){
    const id=url.searchParams.get('id')?.replace(/^eq\./,'');
    if(!backendAccounts.some((item:any)=>item.id===id))return json({message:'Conta fora da fixture'},403);
    backendAccounts=backendAccounts.map((item:any)=>item.id===id?{...item,...body}:item);
    return json([]);
  }
  if(resource==='import_configs'){
    if(method!=='GET')events.push({action:'config-'+method,payload:body});
    if(scenario==='config-error'&&method!=='GET')return json({message:'Falha sintética ao salvar configuração'},400);
    const id=url.searchParams.get('id')?.replace(/^eq\./,'');
    if(method==='POST')configRows.push(...(Array.isArray(body)?body:[body]).map((item:any)=>({...item,id:'saved-config-'+(++sequence)})));
    if(method==='PATCH')configRows=configRows.map(item=>item.id===id?{...item,...body}:item);
    if(method==='DELETE')configRows=configRows.filter(item=>item.id!==id);
    return json(method==='GET'?configRows:[]);
  }
  if(resource==='family_members')return json([]);
  if(resource==='transacoes')return json(useAppStore.getState().transactions);
  if(resource==='product_events')return json([]);
  return json({message:'Destino fechado na referência'},403);
};
const originalBulk=useAppStore.getState().addMultipleTransactions;
const originalRead=FileReader.prototype.readAsText;
if(scenario==='file-read-loading')FileReader.prototype.readAsText=function(...args:Parameters<FileReader['readAsText']>){pending.set('file-read',()=>originalRead.apply(this,args));};
window.open=((url:URL|string)=>{const target=new URL(String(url));events.push({action:'open-integration-window',host:target.host,path:target.pathname});return null;}) as typeof window.open;
const updateList=(key:string,update:(items:any[])=>any[])=>useAppStore.setState((s:any)=>({[key]:update(s[key])}));
const crud=(key:string)=>(payload:any)=>{events.push({action:key+'-save',payload});updateList(key,items=>payload.id?items.map(i=>i.id===payload.id?{...i,...payload}:i):[...items,{...payload,id:'new-'+(++sequence)}]);};
useAppStore.setState({user,transactions:transactions as unknown as Transaction[],transactionsUserId:userId,accounts,categories,mappingRules:rules,importConfigs:configs,importLogs:logs,budgets:[],assets:[],economicEvents:[],isLoading:false,initialDataLoadStatus:'ready',isPremium:params.get('plan')!=='free',isWealth:false,unlimitedSync:params.get('unlimited')==='true',atomicImportEnabled:params.get('atomic')==='on',currentView:'import',creditCardShadowDashboard:null,creditCardReprocessJobs:[],
  addMultipleTransactions:async(...args:any[])=>{events.push({action:'parsed-import',arguments:args});return originalBulk(...args);},
  addTransaction:async(payload:any)=>{events.push({action:'add',payload});if(scenario==='integration-persist-error')throw Error('Falha sintética ao salvar revisão');if(scenario==='integration-persist-loading'&&reviewDelay){reviewDelay=false;await wait('review-persist');}updateList('transactions',items=>[...items,wire({...payload,ID_Transacao:'of-new-'+(++sequence),user_id:userId})]);},
  updateTransaction:async(payload:any)=>{events.push({action:'update',payload});updateList('transactions',items=>items.map(t=>t.ID_Transacao===payload.ID_Transacao?wire({...t,...payload}):t));},
  addMappingRule:async(payload:any)=>crud('mappingRules')(payload),updateMappingRule:async(payload:any)=>crud('mappingRules')(payload),
  deleteMappingRule:async(id:string)=>{events.push({action:'rule-delete',id});updateList('mappingRules',items=>items.filter(i=>i.id!==id));},
  addImportConfig:async(payload:any)=>crud('importConfigs')(payload),updateImportConfig:async(payload:any)=>crud('importConfigs')(payload),
  addAccount:async(payload:any)=>{const account=wire({...payload,id:'created-account-'+(++sequence),user_id:userId});events.push({action:'account',payload});updateList('accounts',items=>[...items,account]);return account;},
  updateAccount:async(payload:any)=>crud('accounts')(payload),
  deleteImportLog:async(id:string,fileName:string)=>{events.push({action:'delete-import',id,fileName});updateList('transactions',items=>items.filter(t=>t.import_log_id!==id));updateList('importLogs',items=>items.filter(i=>i.id!==id));},
  deleteImportConfig:async(id:string)=>{events.push({action:'delete-config',id});updateList('importConfigs',items=>items.filter(i=>i.id!==id));},
  reassignTransactionsAccountByImportLog:async(id:string,accountId:string)=>{events.push({action:'reassign',id,accountId});const count=useAppStore.getState().transactions.filter((t:any)=>t.import_log_id===id).length;updateList('transactions',items=>items.map(t=>t.import_log_id===id?{...t,ID_Conta:accountId}:t));return{updated:count};},
  repairImportLogsImportedDetailsFromLedger:async()=>{events.push({action:'repair-history'});return{updated:0,message:'Histórico sintético conferido sem alterações'};},
  syncLegacyImportLogs:async()=>{events.push({action:'sync-history'});},
  fetchImportLogs:async()=>{useAppStore.setState({importLogs:logs});},fetchImportConfigs:async()=>{useAppStore.setState({importConfigs:configRows});},fetchTransactions:async()=>undefined,fetchAssets:async()=>undefined,refreshCreditCardShadowDashboard:async()=>undefined,fetchCreditCardReprocessJobs:async()=>undefined,
  updateUserPreferences:async(payload:any)=>{events.push({action:'preferences',payload});useAppStore.setState((s:any)=>({user:{...s.user,user_metadata:{...s.user.user_metadata,...payload}}}));},
  reApplyAllRules:async()=>{events.push({action:'reapply-rules'});},findDuplicateRules:()=>[],setHelpIntent:(intent:any)=>{events.push({action:'help-intent',intent});},
  setCurrentView:(view:string)=>{events.push({action:'navigate',view});useAppStore.setState({currentView:view});},
});
(window as any).__importPreview={snapshot:()=>wire({rows:useAppStore.getState().transactions,accounts:useAppStore.getState().accounts,backendAccounts,connections:connectionRows,balances:useAppStore.getState().getAccountsWithCalculatedBalance(),logs:useAppStore.getState().importLogs,configs:useAppStore.getState().importConfigs,rules:useAppStore.getState().mappingRules,events,requests:(window as any).__importRequests.filter((request:any)=>request.path.startsWith('/api/belvo-')||request.path.includes('/rpc/')||/\/(import_configs|pluggy_connections|contas|transacoes)$/.test(request.path))}),release:(key:string)=>{pending.get(key)?.();pending.delete(key);},requests:()=>(window as any).__importRequests};
const history=params.get('view')==='history',theme=params.get('theme')==='light'?'light':'dark';
function HistoryScope(){
  React.useLayoutEffect(()=>{
    const ids=['settings-logs','settings-configs','settings-rules'];
    const selected=ids.map(id=>document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const visible=params.get('section')??'logs';
    for(const element of selected){
      let child:HTMLElement=element,parent=child.parentElement;
      while(parent&&parent.id!=='import-history-root'){
        for(const sibling of parent.children)if(sibling!==child&&!ids.some(id=>sibling.id===id||sibling.querySelector('#'+id)))(sibling as HTMLElement).style.display='none';
        child=parent;parent=parent.parentElement;
      }
      element.style.display=element.id==='settings-'+visible?'':'none';
    }
  },[]);
  return <div id="import-history-root"><SettingsView/></div>;
}
function Preview(){
  const currentView=useAppStore((s:any)=>s.currentView);
  const [reviewOpen,setReviewOpen]=React.useState(true);
  return <div data-finelo-theme={theme} className="bg-theme-canvas text-theme-content min-h-screen p-4 sm:p-6">
    {params.get('view')==='review'?<OpenFinanceReviewModal isOpen={reviewOpen} connection={connection} onClose={()=>setReviewOpen(false)} onSuccess={(inserted:number,merged:number)=>events.push({action:'review-result',inserted,merged})}/>:history?<HistoryScope/>:currentView==='import'?<ImportView/>:<p role="status">Destino de navegação: {currentView}</p>}
    <GlobalDialog/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
