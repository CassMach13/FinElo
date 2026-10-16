import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import NetWorthSummaryCard from '../../src/components/dashboard/NetWorthSummaryCard';
import CurrentNetWorthCard from '../../src/components/dashboard/CurrentNetWorthCard';
import { computeCurrentNetWorth } from '../../src/domain/dashboard/currentNetWorth';
import { projectAccountCardEconomics } from '../../src/services/accountCardEconomics';
import { buildDirectedPurchaseDescription, buildDirectedPaymentDescription } from '../../src/services/creditCardDirectedPayment';
import type { Account, Transaction, Asset } from '../../src/types';
const date=(s:string)=>new Date(s+'T12:00:00');
const account=(id:string,type:Account['Tipo_Conta'],balance:number)=>({id,user_id:'synthetic',Nome_Conta:id,Tipo_Conta:type,Saldo_Inicial:balance,Data_Saldo_Inicial:date('2025-01-01'),dia_vencimento:10}) as Account;
function Preview(){
  const [scenario,setScenario]=useState('pilot'),[compare,setCompare]=useState(false),[legacy,setLegacy]=useState(false);
  const bank=account('Banco sintético','Conta Corrente',scenario==='negative'?-200:201.43);
  const benefit=account('Benefício sintético','Cartão Alimentação',674.85),card=account('Cartão sintético','Cartão de Crédito',-1471.8);
  const accounts=[bank,benefit,card],rows:Transaction[]=scenario==='partial'?[]:[{
    ID_Transacao:'synthetic-purchase',ID_Conta:card.id,user_id:'synthetic',Valor:-7437.11,Tipo:'Despesa',Origem:'manual',Fonte:'Manual',Categoria:'Teste',Nome_Fantasia:'Compra',
    Data:date('2026-09-01'),Data_Pagamento:date(scenario==='future'?'2026-11-10':'2026-10-10'),Descricao_Original:buildDirectedPurchaseDescription(scenario==='future'?'2026-10':'2026-09','Compra'),
  }];
  if(scenario==='paid'||scenario==='reconciliation')rows.push({...rows[0],ID_Transacao:'synthetic-payment',Valor:scenario==='paid'?7437.11:7437.33,Tipo:'Renda',Nome_Fantasia:'Pagamento de Fatura',Descricao_Original:buildDirectedPaymentDescription('2026-09')});
  const economics=projectAccountCardEconomics({account:card,accounts,transactions:rows,importLogs:[],asOf:'2026-10-15'});
  const position=computeCurrentNetWorth({asOf:'2026-10-15',accounts,transactions:rows,assets:[{value:75500,remaining_balance:0} as Asset],investmentsCents:7881073,cards:[economics]});
  return <main style={{maxWidth:920,margin:'24px auto',padding:16}}>
    <h1 style={{marginBottom:16,fontSize:20}}>FinElo · dados sintéticos para validação local</h1>
    <div style={{display:'flex',gap:16,flexWrap:'wrap',marginBottom:24}}>
      <label>Cenário <select aria-label="Cenário" value={scenario} onChange={e=>setScenario(e.target.value)} style={{color:'#111',padding:6}}>
        {['pilot','negative','partial','future','paid','reconciliation','loading','error'].map(s=><option key={s}>{s}</option>)}
      </select></label>
      <label><input type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)}/> Comparação operacional</label>
      <label><input type="checkbox" checked={legacy} onChange={e=>setLegacy(e.target.checked)}/> Flag V2 desligada</label>
    </div>
    <p style={{marginBottom:16}}>Comparação operacional {compare?'ativa':'inativa'}</p>
    {legacy?<NetWorthSummaryCard total={153715.21} accounts={-595.52} investments={78810.73} assetsNet={75500} assetsGross={75500} assetsDebts={0}/>:<CurrentNetWorthCard position={scenario==='loading'||scenario==='error'?null:position} status={scenario==='loading'?'loading':scenario==='error'?'error':'ready'} scopeLabel="Você" onRetry={()=>setScenario('pilot')}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
