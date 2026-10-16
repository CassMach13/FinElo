import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CurrentNetWorthCard from '../../src/components/dashboard/CurrentNetWorthCard';
import { computeCurrentNetWorth } from '../../src/domain/dashboard/currentNetWorth';
import type { CurrentNetWorthPosition } from '../../src/domain/dashboard/currentNetWorth';
const blank=computeCurrentNetWorth({asOf:'2026-10-15',accounts:[],transactions:[],assets:[],investmentsCents:0,cards:[]});
const pilot:CurrentNetWorthPosition={...blank,bankBalanceCents:20143,restrictedBenefitsCents:67485,investmentsCents:7881073,assetsNetCents:7550000,
  assetsGrossCents:7550000,cardObligationsCents:743711,overdueCardObligationsCents:743711,upcomingCardObligationsCents:0,availableAfterOverdueCents:-723568,netWorthCents:14774990};
const html=(position:CurrentNetWorthPosition|null=pilot,status:'ready'|'loading'|'error'='ready')=>renderToStaticMarkup(
  React.createElement(CurrentNetWorthCard,{position,status,scopeLabel:'Você',onRetry:()=>{}})).replaceAll(' ',' ');
describe('apresentação patrimonial atual',()=>{
  it('expõe os componentes e mantém banco separado do disponível negativo',()=>{
    const s=html();for(const label of ['Saldo bancário','Benefícios de uso restrito','Obrigações de cartões','Disponível após obrigações vencidas','Patrimônio líquido'])expect(s).toContain(label);
    expect(s).toContain('R$ 201,43');expect(s).toContain('-R$ 7.235,68');expect(s).toContain('R$ 147.749,90');
    expect(s).toContain('15/10/2026');expect(s).not.toContain('Liquidez imediata');
  });
  it('fatura futura não entra na linha de vencidas',()=>{
    const s=html({...pilot,overdueCardObligationsCents:0,upcomingCardObligationsCents:743711,availableAfterOverdueCents:20143});
    expect(s).toContain('Vencidas: R$ 0,00 · A vencer: R$ 7.437,11');
  });
  it('carga esconde valor anterior e anuncia estado sem zero financeiro presumido',()=>{
    const s=html(pilot,'loading');expect(s).toContain('aria-busy="true"');expect(s).toContain('role="status"');
    expect(s).not.toContain('147.749,90');expect(s).not.toContain('R$ 0,00');
  });
  it('erro dá ação de recuperação e não exibe saldo de outra carga',()=>{
    const s=html(null,'error');expect(s).toContain('role="alert"');expect(s).toContain('Tentar novamente');expect(s).not.toContain('R$ 0,00');
  });
  it('completude parcial mostra componentes conhecidos sem patrimônio ou disponível falsos',()=>{
    const s=html({...pilot,completeness:'partial',netWorthCents:null,cardObligationsCents:null,overdueCardObligationsCents:null,upcomingCardObligationsCents:null,availableAfterOverdueCents:null});
    expect(s).toContain('fontes incompletas');expect(s).toContain('R$ 201,43');expect(s).not.toContain('147.749,90');
  });
  it('conciliação é informação separada do valor financeiro',()=>{
    expect(html({...pilot,reconciliationPending:true})).toContain('diferenças sem resolução econômica ficam fora dos valores financeiros');
  });
  it('comparação histórica nunca exibe segunda coluna nem delta patrimonial',()=>{
    const s=html();expect(s).toContain('Comparação histórica de patrimônio indisponível');
    expect(s).not.toContain('Posição no fim de cada período');expect(s).not.toContain('%');
  });
  it('saldo bancário negativo e financiamento são apresentados sem ocultar a subtração',()=>{
    const s=html({...pilot,bankBalanceCents:-20000,assetFinancingCents:100000});
    expect(s).toContain('-R$ 200,00');expect(s).toContain('R$ 75.500,00 em bens − R$ 1.000,00 em financiamentos');
  });
  it('mantém explicações sob demanda, recolhidas por padrão, com aviso histórico curto',()=>{
    const s=html();
    const disclosure=s.match(/<details[^>]*data-net-worth-details=""[^>]*>/)?.[0];
    expect(disclosure).toBeDefined();expect(disclosure).not.toMatch(/\bopen(?:=|\s|>)/);
    expect(s.indexOf('Saldo efetivo das contas')).toBeGreaterThan(s.indexOf('<details'));
    expect(s.indexOf('não compensam faturas vencidas')).toBeGreaterThan(s.indexOf('<details'));
    expect(s).toContain('Como ler estes valores');
    expect(s).toContain('Comparação histórica de patrimônio indisponível.');
  });
  it('conserva o crédito comprovado como componente separado, sem mudar nenhum valor recebido',()=>{
    const position=Object.freeze({...pilot,provenCardCreditCents:1234});
    const s=html(position);
    expect(s).toContain('Créditos comprovados em cartões');expect(s).toContain('R$ 12,34');
    expect(s).toContain('R$ 147.749,90');expect(s).toContain('-R$ 7.235,68');
    expect(position.provenCardCreditCents).toBe(1234);expect(position.netWorthCents).toBe(14774990);
  });
  it('preserva sinal de patrimônio negativo e distingue o saldo disponível negativo por texto',()=>{
    const s=html({...pilot,netWorthCents:-10000});
    expect(s).toContain('-R$ 100,00');expect(s).toContain('Saldo negativo após vencidas');
    expect(s).toContain('-R$ 7.437,11');expect(s).toContain('-R$ 7.235,68');
    expect(html({...pilot,availableAfterOverdueCents:0})).not.toContain('Saldo negativo após vencidas');
  });
  it('mantém avisos de conciliação e arquivamento, com a explicação completa na expansão',()=>{
    const s=html({...pilot,reconciliationPending:true,archivedAccountsWithPosition:1});
    const visibleSummary=s.slice(0,s.indexOf('<details'));
    expect(visibleSummary).toContain('Conciliação pendente');expect(visibleSummary).toContain('Contas arquivadas incluídas');
    expect(s).toContain('Inclui contas arquivadas com saldo ou obrigação registrada.');
    expect(s).toContain('diferenças sem resolução econômica ficam fora dos valores financeiros');
  });
});
