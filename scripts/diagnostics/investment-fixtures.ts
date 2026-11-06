export const INVESTMENT_A='10000000-0000-4000-8000-000000000001';
export const INVESTMENT_B='10000000-0000-4000-8000-000000000002';
export const INVESTMENT_C='10000000-0000-4000-8000-000000000003';
const id=(group:number,n:number)=>`${group}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function createInvestmentFixture(scenario='complete'){
 const portfolios:any[]=[{id:id(7,1),user_id:INVESTMENT_A,name:'Reserva sintética QA'},{id:id(7,2),user_id:INVESTMENT_A,name:'Longo prazo QA'},{id:id(7,3),user_id:INVESTMENT_A,name:'Carteira arquivada QA',archived_at:'2026-10-01T12:00:00Z'},{id:id(7,4),user_id:INVESTMENT_B,name:'Carteira exclusiva B QA'}].map(p=>({archived_at:null,created_by:p.user_id,updated_by:null,created_at:'2025-01-01T12:00:00Z',updated_at:'2025-01-01T12:00:00Z',...p}));
 const holdings:any[]=[1,2,3,4,5].map((n)=>({id:id(8,n),user_id:INVESTMENT_A,portfolio_id:portfolios[n===3?1:0].id,display_name:'Ativo A QA '+n,institution_ref:n===2?'Banco Sintético QA':'XP QA',product_type_ref:n===3?'Fundos de Investimentos':'Renda Fixa',created_by:INVESTMENT_A,updated_by:null,created_at:'2025-01-01T12:00:00Z',updated_at:'2025-01-01T12:00:00Z'}));
 const positions:any[]=[];let seq=0;
 for(let month=0;month<12;month++){
  const date=new Date(2025,11+month,1),ref=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-01`;
  if(scenario==='incomplete'&&[2,5,7].includes(month))continue;
  for(let n=1;n<=6;n++){
   const cents=100000+n*2719+month*1007;
   positions.push({id:id(3,++seq),user_id:INVESTMENT_A,institution:n===2?'Banco Sintético QA':n===4?'Instituição extensa de investimentos sintéticos QA':'XP QA',product_type:['Renda Fixa','Renda Fixa','Fundos de Investimentos','Renda Variável','Previdência Privada','Outros'][n-1],product_name:`Produto A QA ${n} — ${['CDB CDI','LCI','Fundo RF','Ações','Previdência','Sem classificação'][n-1]}`,balance:cents/100,invested_principal:(cents-1257)/100,original_applied_amount:(cents-2000)/100,gross_return_amount:n===5?12.57:undefined,application_date:'2025-01-13',maturity_date:n===1?'2026-10-10':n===2?'2027-05-10':n===3?'2026-12-15':undefined,yield_rate:n===1?'105% CDI':undefined,monthly_yield_rate:n===3?'0,75%':undefined,reference_month:ref,source_file:'sintetico-qa.xlsx',portfolio_id:n<=5?holdings[n-1].portfolio_id:null,holding_id:n<=5?holdings[n-1].id:null,classified_by:n<=5?INVESTMENT_A:null,classified_at:n<=5?'2025-01-01T12:00:00Z':null,created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z'});
  }
  positions.push({id:id(3,++seq),user_id:INVESTMENT_B,institution:'Instituição B QA',product_type:'Renda Fixa',product_name:'Produto B QA exclusivo',balance:(777777+month*333)/100,invested_principal:7000,reference_month:ref,portfolio_id:portfolios[3].id,holding_id:null,created_at:'2026-01-01T12:00:00Z',updated_at:'2026-01-01T12:00:00Z'});
  positions.push({id:id(3,++seq),user_id:INVESTMENT_C,institution:'Instituição C QA',product_type:'Renda Fixa',product_name:'Produto C QA exclusivo',balance:(43210+month*17)/100,reference_month:ref,portfolio_id:null,holding_id:null,created_at:'2026-01-01T12:00:00Z',updated_at:'2026-01-01T12:00:00Z'});
 }
 if(scenario==='previous-only')for(let i=positions.length-1;i>=0;i--)if(positions[i].reference_month==='2026-11-01')positions.splice(i,1);
 if(scenario==='flows')for(const p of positions)if(p.user_id===INVESTMENT_A&&p.reference_month==='2026-11-01'){p.balance+=p.product_type==='Renda Variável'?-500:1000;}
 if(scenario==='empty')positions.splice(0,positions.length);
 if(scenario==='single')positions.splice(0,positions.length,...positions.filter(p=>p.user_id===INVESTMENT_A&&p.product_name.startsWith('Produto A QA 1')));
 if(scenario==='zero'||scenario==='negative')for(const p of positions)if(p.user_id===INVESTMENT_A)p.balance=scenario==='zero'?0:-Math.abs(p.balance);
 if(scenario==='unclassified')for(const p of positions){p.portfolio_id=null;p.holding_id=null;p.classified_by=null;p.classified_at=null;}
 if(scenario==='long')for(let i=0;i<35;i++)positions.push({...positions[0],id:id(3,++seq),reference_month:'2026-11-01',product_name:'Produto A QA detalhamento extenso '+String(i+1).padStart(2,'0'),institution:'Instituição sintética '+i,balance:(10000+i*331)/100,portfolio_id:null,holding_id:null});
 const family=[{id:id(9,1),owner_id:INVESTMENT_B,owner_email:'titular-b@example.invalid',member_email:'investimento-a@example.invalid',status:'accepted',created_at:'2025-01-01T12:00:00Z'}];
 const assets=[{id:id(5,1),user_id:INVESTMENT_A,name:'Imóvel sintético QA',type:'property',value:250000,is_financed:true,financing_type:'financing',financed_amount:150000,remaining_balance:100000,installment_value:1250,total_installments:120,paid_installments:40,monthly_interest_rate:1,updated_at:'2026-11-01T12:00:00Z'},{id:id(5,2),user_id:INVESTMENT_A,name:'Veículo sintético QA',type:'car',value:90000,is_financed:true,financing_type:'consortium',remaining_balance:30000,financed_amount:60000,installment_value:1000,total_installments:60,paid_installments:30,consortium_admin_rate:10,updated_at:'2026-11-01T12:00:00Z'},{id:id(5,3),user_id:INVESTMENT_A,name:'Bem sem dívida QA',type:'other',value:0,is_financed:false,updated_at:'2026-11-01T12:00:00Z'}];
 return {scenario,positions,portfolios,holdings,family,assets};
}
