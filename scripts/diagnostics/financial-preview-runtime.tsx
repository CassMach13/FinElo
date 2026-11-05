import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/components/appearance/appearance.css';
import type { Transaction, Account, Category } from '../../src/types';

const params = new URLSearchParams(location.search);
const baseline = params.get('baseline');
const prefix = baseline === 'main' ? '/scripts/diagnostics/theme-financial-baseline/src' : '/src';
const loadModule=(path:string)=>(window as any).__financialNativeImport(new URL(prefix+path,location.origin).href);
const {useAppStore} = await loadModule('/hooks/useAppStore.ts');
const {useDialogStore} = await loadModule('/hooks/useDialogStore.ts');
const {GlobalDialog} = await loadModule('/components/ui/GlobalDialog.tsx');
const {default:TransactionsView} = await loadModule('/components/views/TransactionsView.tsx');
const period = await loadModule('/utils/transactionPeriodFilters.ts');
const {default:InstallmentSuggestionModal}=await loadModule('/components/modals/InstallmentSuggestionModal.tsx');
const installmentDomain=await loadModule('/domain/installments/installmentSuggestions.ts');
const date=(iso:string)=>new Date(iso+'T12:00:00');
const userId='synthetic-financial-owner';
const categories:Category[]=[
  {id:'salary',Nome_Categoria:'Salário',Tipo:'Renda'},
  {id:'food',Nome_Categoria:'Alimentação',Tipo:'Despesa'},
  {id:'home',Nome_Categoria:'Casa',Tipo:'Despesa'},
  {id:'movement',Nome_Categoria:'Movimentação',Tipo:'Ambos'},
] as Category[];
const accounts:Account[]=[
  {id:'bank',user_id:userId,Nome_Conta:'Conta principal',Tipo_Conta:'Conta Corrente',Saldo_Inicial:1200,Data_Saldo_Inicial:date('2026-08-01'),bank_id:'cash'},
  {id:'wallet',user_id:userId,Nome_Conta:'Carteira',Tipo_Conta:'Dinheiro em Espécie',Saldo_Inicial:80,Data_Saldo_Inicial:date('2026-08-01'),bank_id:'cash'},
] as Account[];
const row=(id:string,name:string,value:number,category:string,iso='2026-11-03',extra:Partial<Transaction>={}):Transaction=>({
  ID_Transacao:id,user_id:userId,ID_Conta:'bank',Data:iso as unknown as Date,Data_Pagamento:iso,Nome_Fantasia:name,
  Descricao_Original:name,Valor:value,Categoria:category,Tipo:value<0?'Despesa':'Renda',Origem:'manual',Fonte:'Manual',...extra,
} as Transaction);
const originalRows:Transaction[]=[
  row('salary','Salário de novembro',5200,'Salário','2026-11-05'),
  row('groceries','Mercado da semana — compra com descrição longa para validar leitura confortável sem cortar informação importante',-315.87,'Alimentação'),
  row('rent','Aluguel',-1450,'Casa','2026-11-02'),
  row('zero','Ajuste informativo sem impacto',0,'Movimentação','2026-11-01'),
  row('refund','Estorno do mercado',45.6,'Alimentação','2026-11-04'),
  row('imported','Restaurante importado',-72.43,'-','2026-11-04',{Origem:'extrato-sintetico.csv',Fonte:'Importado'}),
  row('installment','Compra parcelada sintética',-123.45,'Casa','2026-09-12',{Parcela_Atual:2,Total_Parcelas:4}),
  row('future','Compromisso futuro',-123.45,'Casa','2026-12-12',{Parcela_Atual:3,Total_Parcelas:4}),
  row('cash','Café na carteira',-12.5,'Alimentação','2026-11-03',{ID_Conta:'wallet'}),
  row('movement-out','Transferência entre contas',-100,'Movimentação','2026-11-03',{economic_event_id:'movement-1'}),
  row('movement-in','Transferência entre contas',100,'Movimentação','2026-11-03',{ID_Conta:'wallet',economic_event_id:'movement-1'}),
  ...['08','09','10'].map((month,i)=>row('recurrence-'+i,'Internet fibra',-99.9,'Casa',`2026-${month}-02`)),
  ...Array.from({length:48},(_,i)=>row('many-'+i,`Lançamento sintético ${String(i+1).padStart(2,'0')}`,-(i+1)*1.23,'Alimentação',`2026-10-${String(i%27+1).padStart(2,'0')}`)),
];
const wireRow=(value:any)=>({...value,Data:value.Data instanceof Date?value.Data.toISOString().slice(0,10):value.Data,Data_Pagamento:value.Data_Pagamento instanceof Date?value.Data_Pagamento.toISOString().slice(0,10):value.Data_Pagamento});
if(params.get('family')==='true') {
  for(let index=0;index<4;index++) {
    accounts.push({...accounts[0],id:`peer-bank-${index}`,Nome_Conta:`Conta familiar ${index+1}`,user_id:`synthetic-financial-peer-${index}`,Saldo_Inicial:300});
    originalRows.push(row(`peer-entry-${index}`,`Despesa familiar ${index+1}`,-85-index,'Casa','2026-11-04',{ID_Conta:`peer-bank-${index}`,user_id:`synthetic-financial-peer-${index}`}));
  }
}
const events:any[]=[];
let sequence=0;
const filters=period.getShowAllTransactionFilters();
localStorage.clear();
localStorage.setItem(period.TRANSACTION_FILTERS_STORAGE_KEY,JSON.stringify(filters));
localStorage.setItem(period.SMART_TRANSACTION_FILTERS_STORAGE_KEY,JSON.stringify(filters));
localStorage.setItem(period.TRANSACTION_FILTERS_PANEL_EXPANDED_KEY,'false');
const allRows=structuredClone(originalRows);
useAppStore.setState({
  user:{id:userId,email:'finance-fixture@example.invalid',user_metadata:{full_name:'Referência financeira'},app_metadata:{smart_transaction_filters_enabled:params.get('filters')==='smart'}},
  transactions:params.get('state')==='empty'||params.get('state')==='loading'?[]:allRows,
  transactionsUserId:userId, accounts,categories,assets:[],importLogs:[],isLoading:params.get('state')==='loading',initialDataLoadStatus:'ready',
  economicEvents:[{id:'movement-1',user_id:userId,kind:'own_account_transfer',source:'bank_import',status:'confirmed'}],
  currentView:'transactions',transactionFilters:filters,isPremium:true,isWealth:true,
  syncAllData:async()=>undefined,fetchAllData:async()=>undefined,
  addTransaction:async(payload:any)=>{
    if(params.get('state')==='save-error')throw new Error('Falha sintética de gravação');
    events.push({action:'add',payload});
    const rows=(Array.isArray(payload)?payload:[payload]).map((v:any)=>wireRow({...v,ID_Transacao:'new-'+(++sequence),user_id:userId}));
    useAppStore.setState((s:any)=>({transactions:[...s.transactions,...rows]}));
  },
  updateTransaction:async(payload:any)=>{events.push({action:'update',payload});useAppStore.setState((s:any)=>({transactions:s.transactions.map((t:Transaction)=>t.ID_Transacao===payload.ID_Transacao?wireRow({...t,...payload}):t)}));},
  deleteTransaction:async(id:string)=>{events.push({action:'delete',id});useAppStore.setState((s:any)=>({transactions:s.transactions.filter((t:Transaction)=>t.ID_Transacao!==id)}));},
  deleteManualTransactions:async(ids:string[])=>{events.push({action:'bulk-delete',ids});useAppStore.setState((s:any)=>({transactions:s.transactions.filter((t:Transaction)=>!ids.includes(t.ID_Transacao))}));return ids.length;},
  deleteImportedBatchByTransaction:async(id:string)=>{events.push({action:'delete-batch',id});return 1;},
  addCategory:async(payload:any)=>{events.push({action:'category',payload});useAppStore.setState((s:any)=>({categories:[...s.categories,{...payload,id:'category-'+(++sequence)}]}));return{status:'created',message:'Categoria sintética criada'};},
  addAccount:async(payload:any)=>{events.push({action:'account',payload});const account={...payload,id:'account-'+(++sequence),user_id:userId};useAppStore.setState((s:any)=>({accounts:[...s.accounts,account]}));return account;},
  updateAccount:async(payload:any)=>{events.push({action:'account-update',payload});useAppStore.setState((s:any)=>({accounts:s.accounts.map((a:Account)=>a.id===payload.id?{...a,...payload}:a)}));},
  addMappingRule:async(payload:any)=>{events.push({action:'mapping-rule',payload});},
  updateUserPreferences:async()=>undefined,
});

(window as any).__financialPreview={
  snapshot:()=>({rows:useAppStore.getState().transactions,balances:useAppStore.getState().getAccountsWithCalculatedBalance(),events}),
  fixture:()=>({rows:originalRows,accounts,categories}),
  closeDialog:()=>useDialogStore.getState().closeDialog(false),
};
const theme=params.get('theme')==='light'?'light':'dark';
const newInstallments=[{ID_Conta:'synthetic-credit',Origem:'xp-ficticia-2026-10.csv',Data:'2026-09-14',Data_Pagamento:'2026-11-20',Descricao_Original:'LOJA SINTETICA 2/4',Nome_Fantasia:'LOJA SINTETICA',Categoria:'-',Valor:-120.5,Parcela_Atual:2,Total_Parcelas:4,referenceMonth:'2026-10'}];
const candidate=(id:string,name:string)=>({idTransacao:id,nomeFantasia:name,categoria:'Casa',valor:-120.5,parcelaAtual:1,totalParcelas:4,data:date('2026-09-14'),confianca:'exata',mesmaDataDeCompra:true,descricaoSemelhante:true,parcelaLidaDoTexto:false});
const installmentSuggestions=[{indice:0,descricaoImportada:'LOJA SINTETICA 2/4',valor:-120.5,parcelaAtual:2,totalParcelas:4,data:date('2026-09-14'),candidatos:params.get('candidates')==='two'?[candidate('sister-a','Compra anterior A'),candidate('sister-b','Compra anterior B')]:[candidate('sister-a','Compra anterior A')]}];
const installmentEvents:any[]=[];
let projectedInstallments=newInstallments;
(window as any).__financialPreview.installments=()=>({original:newInstallments,projected:projectedInstallments,events:installmentEvents});
function InstallmentPreview(){
  const [open,setOpen]=React.useState(true);
  if(!open)return <p>Referência finalizada.</p>;
  return <InstallmentSuggestionModal sugestoes={installmentSuggestions} onConfirm={(choices:Map<number,string|null>)=>{
    projectedInstallments=installmentDomain.aplicarEscolhasDeParcela(newInstallments,installmentSuggestions,choices);
    installmentEvents.push({action:'confirm',choices:[...choices]});setOpen(false);
  }} onCancel={()=>{installmentEvents.push({action:'cancel'});setOpen(false);}}/>;
}
function Preview(){return <div data-finelo-theme={theme} className="bg-theme-canvas text-theme-content min-h-screen p-4 sm:p-6">
  {params.get('view')==='suggestions'?<InstallmentPreview/>:<TransactionsView/>}<GlobalDialog/>
</div>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
