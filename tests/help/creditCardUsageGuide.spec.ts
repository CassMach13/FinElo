import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import CreditCardHelpGuide, { CreditCardProfileContent } from '../../src/components/help/CreditCardHelpGuide';
import { CARD_USAGE_PROFILES, CARD_SHARED_CONCEPTS, getProfileHelpImage, getProfileHelpReferences } from '../../src/data/creditCardUsageGuide';
import { HELP_TOPICS } from '../../src/data/helpCenterContent';

const profileText = (id: string) => {
  const profile = CARD_USAGE_PROFILES.find((item) => item.id === id)!;
  return [profile.how, ...profile.routine, profile.attention].join(' ');
};

describe('guia visual dos três perfis de cartão', () => {
  it('apresenta exatamente os três modos reais e uma comparação sem ranking', () => {
    expect(CARD_USAGE_PROFILES.map((item) => item.id)).toEqual(['import', 'manual', 'mixed']);
    const html = renderToStaticMarkup(React.createElement(CreditCardHelpGuide));
    expect(html).toContain('Há três formas de usar o cartão no FinElo.');
    expect(html).toContain('Qual perfil escolher?');
    expect(html).toContain('Nenhum perfil é melhor que outro.');
    expect(html.match(/aria-pressed=/g)).toHaveLength(3);
    expect(html).toContain('aria-controls="card-usage-profile"');
  });

  it.each(CARD_USAGE_PROFILES)('orienta o perfil $label com rotina, cuidado e artigos existentes', (profile) => {
    const html = renderToStaticMarkup(React.createElement(CreditCardProfileContent, { profile }));
    expect(html).toContain(profile.forWhom);
    expect(html).toContain('Como funciona');
    expect(html).toContain('Rotina recomendada');
    expect(html).toContain('Atenção principal');
    expect(profile.routine).toHaveLength(4);
    for (const topic of getProfileHelpReferences(profile)) {
      expect(HELP_TOPICS).toContain(topic);
      expect(html).toContain(topic.title.replaceAll('&', '&amp;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;'));
    }
  });

  it('orienta a importação sem prometer tratamento universal de pagamentos', () => {
    const text = profileText('import');
    expect(text).toContain('conta do cartão');
    expect(text).toContain('Ajustar competências por arquivo');
    expect(text).toContain('Confira compras, estornos/créditos, pagamentos e saldo em aberto');
    expect(text).toContain('confira se o pagamento já veio no extrato');
    expect(text).not.toContain('automaticamente na competência anterior');
  });

  it('orienta compras e estornos manuais por fatura, não renda genérica ou apenas mês da compra', () => {
    const text = profileText('manual');
    expect(text).toContain('Fatura desta compra');
    expect(text).toContain('vencimento da fatura');
    expect(text).toContain('Estorno ou crédito na fatura');
    expect(text).toContain('Competência da fatura (estorno)');
    expect(text).toContain('Não registre o pagamento como uma renda genérica');
    expect(text).toContain('inclusive quando todos os lançamentos forem manuais');
  });

  it('misto exige conferência da sobreposição e não promete deduplicação automática', () => {
    const text = profileText('mixed');
    expect(text).toContain('Não conte com deduplicação automática');
    expect(text).toContain('já aparece entre os lançamentos importados');
    expect(text).toContain('Auditoria da fatura');
    expect(text).toContain('não corrige uma compra duplicada');
  });

  it('distingue competência, vencimento, fechamento, total e saldo', () => {
    const text = CARD_SHARED_CONCEPTS.map((item) => item.title + ' ' + item.text).join(' ');
    expect(text).toContain('Competência não é vencimento');
    expect(text).toContain('Competência é o mês da fatura');
    expect(text).toContain('09/2026');
    expect(text).toContain('10/10/2026');
    expect(text).toContain('Fechamento e vencimento configuram o ciclo');
    expect(text).toContain('total considera compras e estornos/créditos');
    expect(text).toContain('depois dos pagamentos e confirmações');
  });

  it('Pagar e Sim está pago mantêm contratos diferentes e confirmação vale para saldo inteiro', () => {
    const pay = CARD_SHARED_CONCEPTS.find((item) => item.title === 'Pagar registra o pagamento')!;
    const confirm = CARD_SHARED_CONCEPTS.find((item) => item.title === 'Sim, está pago confirma uma quitação')!;
    expect(pay.text).toContain('saída nessa conta');
    expect(pay.text).toContain('não executa um pagamento no banco');
    expect(confirm.text).toContain('saldo em aberto inteiro');
    expect(confirm.text).toContain('já pago fora do FinElo');
    expect(confirm.text).toContain('Não cria transação e não movimenta conta');
    expect(confirm.text).toContain('Cancelar e Desfazer');
    expect(confirm.text).toContain("Para que serve o 'Sim, está pago'?");
    expect(CARD_USAGE_PROFILES).toHaveLength(3);
  });

  it('reutiliza exatamente três imagens publicadas sem duplicar assets ou metadata', () => {
    const images = CARD_USAGE_PROFILES.map(getProfileHelpImage);
    expect(images.map((image) => image.src)).toEqual([
      '/help/competence/01-vencimento-e-competencia.webp',
      '/help/card-payment/02-modal-pagar-fatura.webp',
      '/help/card-history/01-fatura-no-historico.webp',
    ]);
    for (const [index, image] of images.entries()) {
      const profile = CARD_USAGE_PROFILES[index];
      const topic = HELP_TOPICS.find((item) => item.id === profile.imageTopicId)!;
      expect(image).toBe(topic.article!.steps![profile.imageStepIndex].image);
      expect(existsSync(resolve('public', image.src.slice(1)))).toBe(true);
      expect(image.alt.length).toBeGreaterThan(10);
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);
    }
  });

  it('preserva layout móvel fluido, imagens limitadas e ausência de tabela horizontal', () => {
    const html = renderToStaticMarkup(React.createElement(CreditCardHelpGuide, { embedded: true }));
    expect(html).toContain('grid-cols-1 sm:grid-cols-3');
    expect(html).toContain('min-w-0');
    expect(html).toContain('w-full max-w-full h-auto');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('overflow-x-auto');
    expect(html).not.toContain('Cartão de crédito no FinElo</h2>');
  });
});
