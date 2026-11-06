import {createCardFixture,CARD_QA_BANK,CARD_QA_OWNER} from './card-fixtures';
export const DASHBOARD_OWNER=CARD_QA_OWNER;
export const DASHBOARD_PEER='10000000-0000-4000-8000-000000000002';
export const DASHBOARD_SCENARIOS=['complete','empty','zero','negative','future','multiple','cards','investments','family','long','incomplete','load-error','loading','position-error','position-loading','partial','free','onboarding','onboarding-review','onboarding-view','invite','asset-review'] as const;

/** Synthetic facts only. Input money is declared in integer cents. */
export function createDashboardFixture(scenario:string){
 const card=createCardFixture('installments');
 const accounts:any[]=card.accounts.map(a=>({...a,Data_Saldo_Inicial:'2024-01-01'}));
 accounts[0].Nome_Conta='Conta principal QA';accounts[0].Saldo_Inicial=scenario==='negative'?-90000:2000;
 accounts.push({id:'20000000-0000-4000-8000-000000000004',user_id:DASHBOARD_OWNER,Nome_Conta:'Reserva QA',Tipo_Conta:'Poupança',Saldo_Inicial:1000,Data_Saldo_Inicial:'2024-01-01',bank_id:'cash'});
 accounts.push({id:'20000000-0000-4000-8000-000000000005',user_id:DASHBOARD_OWNER,Nome_Conta:'Benefício restrito QA',Tipo_Conta:'Cartão Alimentação',Saldo_Inicial:500,Data_Saldo_Inicial:'2024-01-01',bank_id:'flash-beneficios'});
 const categories:any[]=[...card.categories,{id:'qa-salary',Nome_Categoria:'Salário',Tipo:'Renda'},{id:'qa-home',Nome_Categoria:'Moradia',Tipo:'Despesa',is_essential:true},{id:'qa-fun',Nome_Categoria:'Lazer',Tipo:'Despesa'},{id:'qa-save',Nome_Categoria:'Aportes',Tipo:'Ambos',is_investment:true}];
 let sequence=100;
 const rows:any[]=[...card.rows];
 const add=(date:string,name:string,cents:number,category:string,extra:any={})=>rows.push({ID_Transacao:'30000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'),user_id:DASHBOARD_OWNER,ID_Conta:CARD_QA_BANK,Data:date,Data_Pagamento:date,Nome_Fantasia:name,Descricao_Original:name,Valor:cents/100,Tipo:cents<0?'Despesa':'Renda',Categoria:category,Origem:'fixture-dashboard.csv',Fonte:'CSV',...extra});
 for(const year of [2025,2026])for(let month=1;month<=(year===2026?10:12);month++){
  if(scenario==='incomplete'&&[2,4,7].includes(month))continue;
  const ref=year+'-'+String(month).padStart(2,'0');
  add(ref+'-03','Salário sintético QA',300000+month*1007+(year===2026?20000:0),'Salário');
  add(ref+'-05','Moradia sintética QA',-90000-month*101,'Moradia');
  add(ref+'-12','Alimentação sintética QA',-30000-month*53,'Alimentação');
  add(ref+'-17','Lazer sintético QA',-20000-month*37,'Lazer');
  add(ref+'-21','Aporte sintético QA',-15000,'Aportes');
 }
 add('2026-11-02','Receita atual QA',330000,'Salário');
 add('2026-11-03','Despesa atual QA',-85000,'Moradia');
 add('2026-11-04','Zero registrado QA',0,'Compras');
 add('2026-11-08','Compra futura QA',-12345,'Compras');
 add('2026-11-10','Receita futura QA',45678,'Salário');
 add('2026-11-18','Saída futura QA',-34567,'Moradia');
 add('2026-10-20','Pagamento de Fatura',10000,'Pagamento Cartão',{ID_Conta:card.accounts[1].id,Origem:'manual',Fonte:'Manual',Descricao_Original:'Pagamento de Fatura (2026-09) finelo_competence:2026-09 finelo_funding_account:'+CARD_QA_BANK});
 add('2026-10-20','Pagamento Fatura — Cartão Sintético QA',-10000,'Pagamento Cartão',{Origem:'manual',Fonte:'Manual',Descricao_Original:'Pagamento Fatura Cartão Sintético QA (2026-09) finelo_competence:2026-09 finelo_funding_account:'+CARD_QA_BANK});
 if(scenario==='long')for(let i=0;i<25;i++){
  const category='Categoria sintética com descrição extensa '+String(i+1).padStart(2,'0');categories.push({id:'qa-long-'+i,Nome_Categoria:category,Tipo:'Despesa'});add('2026-11-03',category,-1000-i*17,category);
 }
 const assets:any[]=[{id:'50000000-0000-4000-8000-000000000001',user_id:DASHBOARD_OWNER,name:'Bem sintético QA',type:'property',value:250000,is_financed:true,remaining_balance:100000,updated_at:'2026-01-01T12:00:00Z'}];
 if(scenario==='asset-review'){assets[0].is_financed=false;assets[0].remaining_balance=0;}
 if(scenario==='onboarding-review')rows[0].Categoria='';
 const investments:any[]=[{id:'60000000-0000-4000-8000-000000000001',user_id:DASHBOARD_OWNER,institution:'Instituição sintética QA',product_type:'Renda Fixa',product_name:'Posição QA',balance:12345.67,reference_month:'2026-10-01',created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-01T12:00:00Z'}];
 const family:any[]=[];
 if(scenario==='family'){
  const peerAccount='20000000-0000-4000-8000-000000000006';
  accounts.push({id:peerAccount,user_id:DASHBOARD_PEER,Nome_Conta:'Conta do familiar QA',Tipo_Conta:'Conta Corrente',Saldo_Inicial:3210.98,Data_Saldo_Inicial:'2024-01-01',bank_id:'cash'});
  add('2026-11-03','Receita do familiar QA',70000,'Salário',{user_id:DASHBOARD_PEER,ID_Conta:peerAccount});
  family.push({id:'90000000-0000-4000-8000-000000000001',owner_id:DASHBOARD_PEER,owner_email:'titular-familiar-qa@example.invalid',member_email:'dashboard-fixture@example.invalid',status:'accepted',created_at:'2026-01-01T12:00:00Z'});
  investments.push({...investments[0],id:'60000000-0000-4000-8000-000000000002',user_id:DASHBOARD_PEER,balance:7654.32,reference_month:'2026-09-01'});
 }
 if(['empty','onboarding','zero','loading','load-error'].includes(scenario))rows.splice(0,rows.length);
 if(['empty','onboarding','zero'].includes(scenario)){assets.splice(0);investments.splice(0);accounts.forEach(a=>a.Saldo_Inicial=0);}
 if(scenario==='zero')add('2026-11-04','Zero registrado QA',0,'Compras');
 if(scenario==='partial')accounts[0].Data_Saldo_Inicial='';
 const budgets:any[]=[{id:'qa-budget-1',user_id:DASHBOARD_OWNER,Categoria:'Moradia',Valor_Limite_Mensal:1000,ano:2026},{id:'qa-budget-2',user_id:DASHBOARD_OWNER,Categoria:'Alimentação',Valor_Limite_Mensal:600,ano:2026}];
 const budgetMonths:any[]=[{id:'80000000-0000-4000-8000-000000000001',user_id:DASHBOARD_OWNER,Categoria:'Moradia',year:2026,month:11,amount:900,created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-01T12:00:00Z'}];
 return {scenario,accounts,rows,categories,assets,investments,family,logs:['empty','onboarding','zero','loading','load-error'].includes(scenario)?[]:card.logs,budgets,budgetMonths};
}
