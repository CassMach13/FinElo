/** Synthetic inputs only. Money is declared in integer cents; no customer data. */
export const CARD_SCENARIOS=['open','closed','paid','partial','second-payment','late','weekend','refund-before','refund-after','installments','legacy-competence','empty','multi-card','insufficient','already-paid','cancel','load-error','authorization-error','persist-error','loading'] as const;
export const CARD_QA_OWNER='10000000-0000-4000-8000-000000000001';
export const CARD_QA_ID='20000000-0000-4000-8000-000000000001';
export const CARD_QA_BANK='20000000-0000-4000-8000-000000000002';
export function createCardFixture(scenario:string){
  let sequence=0;
  const accounts:any[]=[
    {id:CARD_QA_BANK,user_id:CARD_QA_OWNER,Nome_Conta:'Conta de pagamento QA',Tipo_Conta:'Conta Corrente',Saldo_Inicial:5000,Data_Saldo_Inicial:'2026-01-01',bank_id:'cash'},
    {id:CARD_QA_ID,user_id:CARD_QA_OWNER,Nome_Conta:'Cartão Sintético QA',Tipo_Conta:'Cartão de Crédito',Saldo_Inicial:0,Data_Saldo_Inicial:'2026-01-01',bank_id:'cartao-xp',limite_credito:scenario==='insufficient'?150:5000,dia_fechamento:25,dia_vencimento:scenario==='weekend'?21:20,linked_payment_account_id:CARD_QA_BANK},
  ];
  const rows:any[]=[],logs:any[]=[];
  const add=(reference:string,name:string,cents:number,options:any={})=>{
    const next=Number(reference.slice(5))+1;
    const dueDate=`2026-${String(next).padStart(2,'0')}-${scenario==='weekend'?'21':'20'}`;
    const row={ID_Transacao:'30000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'),user_id:CARD_QA_OWNER,ID_Conta:CARD_QA_ID,Data:reference+'-14',Data_Pagamento:dueDate,Nome_Fantasia:name,Descricao_Original:name,Valor:cents/100,Tipo:cents<0?'Despesa':'Renda',Categoria:cents<0?'Compras':name.startsWith('Estorno')?'Estorno':'Pagamento Cartão',Fonte:'Cartao',Origem:`cartao-qa-${reference}.csv`,...options};
    rows.push(row);
    if(row.Origem!=='manual'){
      const id='log-'+row.ID_Conta+'-'+reference;
      row.import_log_id=id;
      let log=logs.find(item=>item.id===id);
      if(!log){log={id,user_id:CARD_QA_OWNER,file_name:row.Origem,import_date:dueDate+'T12:00:00Z',total_transactions:0,imported_count:0,ignored_count:0,imported_details:[],ignored_details:[]};logs.push(log);}
      log.imported_details.push({...row,Card_Reference_Label:reference,Card_Due_Date:row.Data_Pagamento});log.total_transactions++;log.imported_count++;
    }
    return row;
  };
  if(scenario!=='empty'){
    add('2026-09','Compra de setembro QA',10000*-1);
    add('2026-10','Mercado QA',-20000);
    add('2026-10','Compra parcelada QA',-12345,{Data:'2026-09-14',Parcela_Atual:2,Total_Parcelas:3});
    add('2026-11','Compra prevista QA',-12345,{Data:'2026-09-14',Parcela_Atual:3,Total_Parcelas:3});
    if(['open','installments','multi-card','insufficient'].includes(scenario))add('2026-09','Compra parcelada QA',-12345,{Data:'2026-09-14',Parcela_Atual:1,Total_Parcelas:3});
    if(['refund-before','refund-after'].includes(scenario))add('2026-10','Estorno sintético QA',4567,{Data:scenario==='refund-before'?'2026-10-18':'2026-11-02'});
    if(['paid','partial','second-payment','late'].includes(scenario)){
      const cents=['partial','second-payment'].includes(scenario)?4000:10000;
      const date=scenario==='late'?'2026-11-03':'2026-10-15';
      add('2026-09','Pagamento de Fatura',cents,{Origem:'manual',Fonte:'Manual',Data:date,Data_Pagamento:date,Descricao_Original:'Pagamento de Fatura (2026-09) finelo_competence:2026-09 finelo_funding_account:'+CARD_QA_BANK});
      rows.push({...rows.at(-1),ID_Transacao:'30000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'),ID_Conta:CARD_QA_BANK,Nome_Fantasia:'Pagamento Fatura — Cartão Sintético QA',Descricao_Original:'Pagamento Fatura Cartão Sintético QA (2026-09) finelo_competence:2026-09 finelo_funding_account:'+CARD_QA_BANK,Valor:-cents/100,Tipo:'Despesa'});
    }
    if(scenario==='legacy-competence'){
      // Intentionally inconsistent historical metadata; the product decides how to display it.
      logs[0].imported_details=logs[0].imported_details.map((row:any)=>({...row,Card_Reference_Label:'2026-08'}));
    }
    if(scenario==='multi-card'){
      const second={...accounts[1],id:'20000000-0000-4000-8000-000000000003',Nome_Conta:'Segundo cartão QA',limite_credito:800,dia_vencimento:28};accounts.push(second);
      add('2026-10','Compra no segundo cartão',-90000,{ID_Conta:second.id,Origem:'segundo-cartao-2026-10.csv',Data_Pagamento:'2026-11-28'});
    }
  }
  const singleReference:Record<string,string>={open:'2026-11',closed:'2026-10',paid:'2026-09',partial:'2026-09','second-payment':'2026-09',late:'2026-09',weekend:'2026-10','refund-before':'2026-10','refund-after':'2026-10','already-paid':'2026-09'};
  if(singleReference[scenario]){
    const ref=singleReference[scenario];
    const kept=rows.filter(row=>String(row.Origem).includes(ref)||String(row.Descricao_Original).includes('finelo_competence:'+ref));
    rows.splice(0,rows.length,...kept);
    const ids=new Set(rows.map(row=>row.ID_Transacao));
    for(const log of logs){log.imported_details=log.imported_details.filter((row:any)=>ids.has(row.ID_Transacao));log.imported_count=log.imported_details.length;log.total_transactions=log.imported_count;}
    logs.splice(0,logs.length,...logs.filter(log=>log.imported_count));
  }
  return{scenario,accounts,rows,logs,categories:[{id:'qa-purchases',Nome_Categoria:'Compras',Tipo:'Despesa'},{id:'qa-refund',Nome_Categoria:'Estorno',Tipo:'Renda'},{id:'qa-payment',Nome_Categoria:'Pagamento Cartão',Tipo:'Renda'},{id:'qa-food',Nome_Categoria:'Alimentação',Tipo:'Despesa'}],rules:[]};
}
