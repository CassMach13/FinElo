import { describe, expect, it } from 'vitest';
import { projectAccountCardEconomics, cardClassificationRulesFromMetadata } from '../../src/services/accountCardEconomics';
import { computeCurrentNetWorth, selectCurrentNetWorthScope } from '../../src/domain/dashboard/currentNetWorth';
import { buildDirectedPurchaseDescription, buildDirectedPaymentDescription, buildDirectedRefundDescription } from '../../src/services/creditCardDirectedPayment';
import { computeAccountCardDisplay } from '../../src/components/transactions/accountBalanceCardMetrics';
import type { Account, Transaction, Asset } from '../../src/types';
const TODAY='2026-10-15';
const date=(s:string)=>new Date(s+'T12:00:00');
const acc=(id:string,type:Account['Tipo_Conta']='Conta Corrente',balance=0,extra:Partial<Account>={}):Account=>({
  id,user_id:'a',Nome_Conta:id,Tipo_Conta:type,Saldo_Inicial:balance,Data_Saldo_Inicial:date('2025-01-01'),dia_vencimento:10,...extra,
});
let seq=0;
const tx=(id:string,value:number,kind='purchase',ref='2026-09',extra:Partial<Transaction>={}):Transaction=>({
  ID_Transacao:'t'+(++seq),user_id:'a',ID_Conta:id,Data:date('2026-09-15'),Data_Pagamento:date('2026-10-10'),
  Valor:value,Tipo:value<0?'Despesa':'Renda',Categoria:'Teste',Fonte:'Manual',Origem:'manual',
  Nome_Fantasia:kind==='payment'?'Pagamento de Fatura':'Compra',
  Descricao_Original:kind==='payment'?buildDirectedPaymentDescription(ref):kind==='refund'?buildDirectedRefundDescription(ref):buildDirectedPurchaseDescription(ref,'Compra'),
  ...extra,
});
const card=acc('card','Cartão de Crédito',-1471.8);
const project=(rows:Transaction[],extra:Partial<Parameters<typeof projectAccountCardEconomics>[0]>={})=>
  projectAccountCardEconomics({account:card,accounts:[card],transactions:rows,importLogs:[],asOf:TODAY,...extra});
const position=(rows:Transaction[], accounts=[acc('bank','Conta Corrente',201.43),acc('benefit','Cartão Alimentação',674.85),card],extra:Partial<Parameters<typeof computeCurrentNetWorth>[0]>={})=>
  computeCurrentNetWorth({asOf:TODAY,accounts,transactions:rows,assets:[{value:75500,remaining_balance:0} as Asset],investmentsCents:7881073,
    cards:accounts.filter(a=>a.Tipo_Conta==='Cartão de Crédito').map(account=>projectAccountCardEconomics({account,accounts,transactions:rows,importLogs:[],asOf:TODAY})),...extra});
describe('posição patrimonial atual V2 — decisões financeiras',()=>{
  it('piloto: banco intacto, benefício separado, disponível negativo e patrimônio sem dupla dívida',()=>{
    const rows=[tx('card',-7437.11)], p=position(rows);
    expect(p.completeness).toBe('complete');
    expect(p.bankBalanceCents).toBe(20143); expect(p.restrictedBenefitsCents).toBe(67485);
    expect(p.overdueCardObligationsCents).toBe(743711); expect(p.availableAfterOverdueCents).toBe(-723568);
    expect(p.netWorthCents).toBe(14774990);
    expect(p.origin.historicalComparison).toBe('unavailable');
  });
  it.each([500,-200])('saldo bancário %s permanece assinado e não é regravado pelo passivo',(balance)=>{
    const bank=acc('bank','Conta Corrente',balance), initial={...bank};
    const p=position([tx('card',-300)],[bank,card]);
    expect(p.bankBalanceCents).toBe(balance*100); expect(p.availableAfterOverdueCents).toBe((balance-300)*100);
    expect(bank).toEqual(initial);
  });
  it('benefícios e crédito remanescente não compensam dívida no disponível bancário',()=>{
    const p=position([tx('card',-100)]);
    expect(p.availableAfterOverdueCents).toBe(10143); expect(p.restrictedBenefitsCents).toBe(67485);
  });
  it.each([{payment:0,expected:100000},{payment:400,expected:60000},{payment:1000,expected:0}])('vencida com pagamento reconhecido de $payment',({payment,expected})=>{
    const rows=[tx('card',-1000),...(payment?[tx('card',payment,'payment')]:[])], p=project(rows);
    expect(p.amounts?.overdueUnpaidCents).toBe(expected); expect(p.amounts?.totalRecognizedCents).toBe(expected);
  });
  it('fatura ainda não vencida reduz patrimônio, mas não o disponível após vencidas',()=>{
    const rows=[tx('card',-500,'purchase','2026-10',{Data_Pagamento:date('2026-11-10')})],p=position(rows);
    expect(p.cardObligationsCents).toBe(50000); expect(p.overdueCardObligationsCents).toBe(0);
    expect(p.availableAfterOverdueCents).toBe(20143); expect(p.netWorthCents).toBe(15468701);
  });
  it('compra manual diária antes do fechamento entra na fatura escolhida, sem depender de importação',()=>{
    const p=project([tx('card',-100,'purchase','2026-10',{Data:date('2026-10-02'),Data_Pagamento:date('2026-11-10')})],{account:{...card,dia_fechamento:20}});
    expect(p.completeness).toBe('complete'); expect(p.amounts?.upcomingCents).toBe(10000);
    expect(p.origin.manualTransactions).toBe(1);
  });
  it('pagamento depois do vencimento, já ocorrido, quita sem dívida vencida fantasma',()=>{
    const p=project([tx('card',-500),tx('card',500,'payment','2026-09',{Data:date('2026-10-13'),Data_Pagamento:date('2026-10-13')})]);
    expect(p.amounts?.totalRecognizedCents).toBe(0); expect(p.amounts?.overdueUnpaidCents).toBe(0);
  });
  it('parcelas futuras materializadas são compromissos, sem multiplicar Total_Parcelas novamente',()=>{
    const rows=[0,1,2].map(i=>tx('card',-100,'purchase','2026-'+String(9+i).padStart(2,'0'),{
      Data:date('2026-'+String(9+i).padStart(2,'0')+'-15'),Data_Pagamento:date('2026-'+String(10+i).padStart(2,'0')+'-10'),Parcela_Atual:i+1,Total_Parcelas:3,
    }));
    const p=project(rows); expect(p.amounts?.totalRecognizedCents).toBe(30000);
    expect(p.amounts?.overdueUnpaidCents).toBe(10000); expect(p.amounts?.upcomingCents).toBe(20000);
  });
  it('parcela isolada informa apenas o valor reconhecido, sem inventar parcelas ausentes',()=>{
    expect(project([tx('card',-100,'purchase','2026-09',{Parcela_Atual:2,Total_Parcelas:12})]).amounts?.totalRecognizedCents).toBe(10000);
  });
  it('pagamento com banco tem duas pernas e mantém patrimônio; não vira nova despesa patrimonial',()=>{
    const bank=acc('bank','Conta Corrente',1000),accounts=[bank,card],charge=tx('card',-300);
    const before=position([charge],accounts),after=position([charge,tx('card',300,'payment'),tx('bank',-300,'payment')],accounts);
    expect(before.netWorthCents).toBe(after.netWorthCents); expect(after.bankBalanceCents).toBe(70000);
    expect(after.cardObligationsCents).toBe(0);
  });
  it('estorno abate somente uma vez a obrigação',()=>{
    const p=project([tx('card',-1000),tx('card',100,'refund'),tx('card',500,'payment')]);
    expect(p.amounts?.totalRecognizedCents).toBe(40000);
  });
  it('conciliação pendente não vira dívida ou crédito bancário',()=>{
    const rows=[tx('card',-100),tx('card',100.22,'payment')], p=position(rows);
    expect(p.reconciliationPending).toBe(true); expect(p.cardObligationsCents).toBe(0);
    expect(p.provenCardCreditCents).toBe(0); expect(p.availableAfterOverdueCents).toBe(20143);
  });
  it('crédito econômico explícito entra no patrimônio e continua fora do saldo bancário',()=>{
    const rows=[tx('card',-100),tx('card',150,'payment')];
    const c=project(rows,{reconciliationResolutions:{'2026-09':[{kind:'economic_credit',resolvedAmountCents:5000}]}});
    const p=position(rows,undefined,{cards:[c]});
    expect(p.provenCardCreditCents).toBe(5000); expect(p.availableAfterOverdueCents).toBe(20143);
    expect(p.netWorthCents).toBe(15523701);
  });
  it('confirmação de pagamento manual é preservada e não é somada como recurso bancário',()=>{
    const rows=[tx('card',-100)], c=project(rows,{userPaymentConfirmations:[{referenceMonth:'2026-09',settledAmount:100,confirmedAt:'2026-10-12T12:00:00Z'}]});
    expect(c.amounts?.totalRecognizedCents).toBe(0); expect(c.origin.confirmations).toBe(1);
    expect(position(rows,undefined,{cards:[c]}).bankBalanceCents).toBe(20143);
  });
  it('confirmação e posterior pagamento observado não criam crédito automático',()=>{
    const p=project([tx('card',-100),tx('card',100,'payment')],{userPaymentConfirmations:[{referenceMonth:'2026-09',settledAmount:100,confirmedAt:'2026-10-12T12:00:00Z'}]});
    expect(p.amounts?.totalRecognizedCents).toBe(0); expect(p.amounts?.provenCreditCents).toBe(0);
    expect(p.projection.suspenseBalanceCents).toBe(10000);
  });
  it('saldo contábil negativo com fatura quitada não é deduzido',()=>{
    const p=position([tx('card',-100),tx('card',100,'payment')]);
    expect(p.cardObligationsCents).toBe(0); expect(p.netWorthCents).toBe(15518701);
  });
  it('arquivamento não elimina saldo bancário nem obrigações não pagas',()=>{
    const accounts=[acc('oldbank','Conta Corrente',100,{is_archived:true}),{...card,is_archived:true}];
    const p=position([tx('card',-500)],accounts);
    expect(p.bankBalanceCents).toBe(10000); expect(p.cardObligationsCents).toBe(50000);
    expect(p.archivedAccountsWithPosition).toBe(2);
  });
  it('mesmo identificador de conta repetido não duplica passivo',()=>{
    const p=position([tx('card',-100)],[card,card]); expect(p.cardObligationsCents).toBe(10000);
  });
  it('múltiplos cartões com a mesma competência são somados uma vez por conta',()=>{
    const c2=acc('card2','Cartão de Crédito'),p=position([tx('card',-100),tx('card2',-200)],[card,c2]);
    expect(p.cardObligationsCents).toBe(30000);
  });
  it('autoria familiar não remove compras da conta selecionada; outros cartões ficam fora',()=>{
    const rows=[tx('card',-100),tx('card',-20,'purchase','2026-09',{user_id:'b'}),tx('other',-900)];
    expect(position(rows,[card]).cardObligationsCents).toBe(12000);
  });
  it('paridade com a superfície do cartão para compras e pagamentos reconhecidos',()=>{
    const rows=[tx('card',-500),tx('card',100,'payment')],canonical=project(rows);
    const display=computeAccountCardDisplay(card,{accounts:[card],transactions:rows,importLogs:[],cardV2Enabled:true,cardEngineEnabled:true,cardSnapshotPipelineEnabled:false});
    expect(Math.round(display.faturaAtual*100)).toBe(canonical.amounts?.totalRecognizedCents);
  });
});
describe('completude — ausência de prova não vira zero financeiro',()=>{
  it('cartão sem histórico não usa abertura como dívida nem presume quitação',()=>{
    const c=project([]),p=position([],undefined,{cards:[c]});
    expect(c.completeness).toBe('unavailable'); expect(c.amounts).toBeNull();
    expect(p.netWorthCents).toBeNull(); expect(p.availableAfterOverdueCents).toBeNull();
    expect(p.bankBalanceCents).toBe(20143);
  });
  it('cartão esperado com fonte faltante impede os totais dependentes',()=>{
    const p=position([tx('card',-100)],undefined,{cards:[]});
    expect(p.cardObligationsCents).toBeNull(); expect(p.netWorthCents).toBeNull();
  });
  it('sem cartão cadastrado, passivo reconhecido zero é legítimo',()=>{
    const p=position([],[acc('bank','Conta Corrente',-100)]);
    expect(p.completeness).toBe('complete'); expect(p.cardObligationsCents).toBe(0); expect(p.availableAfterOverdueCents).toBe(-10000);
  });
  it.each(['future_payment','future_purchase','duplicate','invalid'])('%s não publica dívida zero como posição completa',(kind)=>{
    let rows=[tx('card',-100)];
    if(kind==='future_payment')rows.push(tx('card',100,'payment','2026-09',{Data:date('2026-11-01')}));
    if(kind==='future_purchase')rows.push(tx('card',-100,'purchase','2026-10',{Data:date('2026-11-01')}));
    if(kind==='duplicate')rows.push({...rows[0]});
    if(kind==='invalid')rows[0]={...rows[0],Valor:NaN};
    expect(project(rows).amounts).toBeNull();
  });
  it('investimentos indisponíveis não impedem mostrar saldo bancário e disponível verificáveis',()=>{
    const p=position([tx('card',-100)],undefined,{investmentsCents:null});
    expect(p.netWorthCents).toBeNull(); expect(p.availableAfterOverdueCents).toBe(10143);
  });
  it('posição de bens inválida não é convertida em zero',()=>{
    expect(position([tx('card',-100)],undefined,{assets:[{value:NaN} as Asset]}).netWorthCents).toBeNull();
  });
  it('abertura futura e conta de investimento sem política de fonte não fabricam posição atual',()=>{
    expect(position([],[acc('future','Conta Corrente',100,{Data_Saldo_Inicial:date('2027-01-01')})]).bankBalanceCents).toBeNull();
    expect(position([],[acc('ambiguous','Investimento',100)]).netWorthCents).toBeNull();
  });
  it('metadados de outra conta com o mesmo nome de arquivo não duplicam a obrigação',()=>{
    const row=tx('card',-100,'purchase','2026-09',{Origem:'statement.csv',Descricao_Original:'Compra importada'});
    const logs=[
      {id:'foreign',file_name:'statement.csv',import_date:'2026-10-10',imported_details:[{ID_Conta:'other',Card_Reference_Label:'2026-08',Card_Due_Date:'2026-09-10'}]},
      {id:'own',file_name:'statement.csv',import_date:'2026-10-01',imported_details:[{ID_Conta:'card',Card_Reference_Label:'2026-10',Card_Due_Date:'2026-11-10'}]},
    ] as any;
    const p=project([row],{importLogs:logs});
    expect(p.amounts?.totalRecognizedCents).toBe(10000);
    expect(p.amounts?.upcomingCents).toBe(10000);expect(p.amounts?.overdueUnpaidCents).toBe(0);
  });
  it('importação sem competência atribuível fica indisponível em vez de zerar o passivo',()=>{
    const p=project([tx('card',-100,'purchase','2026-09',{Origem:'unknown.csv',Descricao_Original:'Compra importada'})]);
    expect(p.amounts).toBeNull();expect(p.issues).toContain('unassigned_import');
  });
  it('metadados só controlam classificação compatível com o cartão, sem usar email para cálculos',()=>{
    expect(cardClassificationRulesFromMetadata({cardPaymentKeywords:['  quitação  '],cardCreditKeywords:[]})).toMatchObject({paymentKeywords:['quitação'],refundKeywords:expect.arrayContaining(['estorno'])});
  });
});

describe('escopo da posição atual independente do toggle operacional',()=>{
  const accounts=[acc('own','Conta Corrente',100),acc('relative','Conta Corrente',500,{user_id:'b'})];
  const assets=[{id:'own-asset',user_id:'a',value:1000},{id:'relative-asset',user_id:'b',value:2000}] as Asset[];
  it('V2 sem seletor de proprietários fica em Você, sem herdar consolidação implícita',()=>{
    const s=selectCurrentNetWorthScope({sessionUserId:'a',scope:null,accounts,assets,knownOwnerIds:['a','b','investment-only']});
    expect(s.label).toBe('Você');expect(s.ownerIds).toEqual(['a']);
    expect(s.accounts.map(a=>a.id)).toEqual(['own']);expect(s.assets.map(a=>a.id)).toEqual(['own-asset']);
  });
  it('família explicitamente selecionada inclui titulares conhecidos que só têm investimentos, uma vez',()=>{
    const s=selectCurrentNetWorthScope({sessionUserId:'a',scope:{kind:'family',key:'a|family',label:'Família',ownerIds:null},accounts,assets,knownOwnerIds:['a','b','investment-only','b']});
    expect(s.accounts).toHaveLength(2);expect(s.assets).toHaveLength(2);
    expect(s.ownerIds).toEqual(['a','b','investment-only']);
  });
  it('visão de familiar seleciona sua propriedade sem transferir o saldo ao autor da consulta',()=>{
    const s=selectCurrentNetWorthScope({sessionUserId:'a',scope:{kind:'owner',key:'a|owner|b',label:'Familiar',ownerIds:['b']},accounts,assets,knownOwnerIds:['a','b']});
    expect(s.ownerIds).toEqual(['b']);expect(s.accounts.map(a=>a.id)).toEqual(['relative']);
  });
});
