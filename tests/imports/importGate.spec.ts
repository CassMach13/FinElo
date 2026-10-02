import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ImportSuccessPanel from '../../src/components/onboarding/ImportSuccessPanel';
import { getImportGate } from '../../src/domain/imports/importGate';

const noop = () => {};
const panel = (props: { canImportAnother?: boolean; quotaNote?: string } = {}) =>
  renderToStaticMarkup(
    React.createElement(ImportSuccessPanel, {
      imported: 8,
      ignored: 0,
      onReviewTransactions: noop,
      onViewDashboard: noop,
      onImportAnother: noop,
      ...props,
    })
  );

const success = { imported: 8, ignored: 0 };

describe('Importação no plano Basic — o sucesso não pode sumir', () => {
  it('A. Basic com cota sobrando: nada é bloqueado e o painel traz todas as ações', () => {
    const gate = getImportGate({ isPremium: false, importsThisMonth: 0, lastSuccess: null });
    expect(gate).toEqual({ quotaExhausted: false, showLimitBlock: false, successOnly: false, canImportAnother: true });
    const html = panel({ canImportAnother: gate.canImportAnother });
    expect(html).toContain('Importação concluída');
    expect(html).toContain('8 transações adicionadas');
    expect(html).toContain('Conferir transações');
    expect(html).toContain('Ver minha Dashboard');
    expect(html).toContain('Importar outro arquivo');
  });

  it('B. Basic acabou de usar a última cota (o log já conta): o sucesso continua visível', () => {
    const gate = getImportGate({ isPremium: false, importsThisMonth: 1, lastSuccess: success });
    expect(gate.quotaExhausted).toBe(true);
    expect(gate.showLimitBlock).toBe(false);
    expect(gate.successOnly).toBe(true);
    const html = panel({ canImportAnother: gate.canImportAnother, quotaNote: 'Você utilizou sua importação gratuita deste mês.' });
    expect(html).toContain('Importação concluída');
    expect(html).toContain('Conferir transações');
    expect(html).toContain('Ver minha Dashboard');
    expect(html).toContain('Você utilizou sua importação gratuita deste mês.');
    // Nada de ação enganosa: não dá para importar outro arquivo sem cota.
    expect(html).not.toContain('Importar outro arquivo');
  });

  it('C. Basic que volta depois com a cota esgotada: o bloqueio de hoje continua', () => {
    const gate = getImportGate({ isPremium: false, importsThisMonth: 1, lastSuccess: null });
    expect(gate.showLimitBlock).toBe(true);
    expect(gate.successOnly).toBe(false);
    expect(gate.canImportAnother).toBe(false);
  });

  it('D. PRO/Wealth: nunca bloqueia e "Importar outro arquivo" fica', () => {
    [0, 1, 5, 40].forEach((importsThisMonth) => {
      [null, success].forEach((lastSuccess) => {
        const gate = getImportGate({ isPremium: true, importsThisMonth, lastSuccess });
        expect(gate).toEqual({ quotaExhausted: false, showLimitBlock: false, successOnly: false, canImportAnother: true });
      });
    });
    expect(panel({ canImportAnother: true })).toContain('Importar outro arquivo');
    expect(panel()).toContain('Importar outro arquivo');
    expect(panel()).not.toContain('importação gratuita');
  });

  it('E. importação sem linhas novas não vira sucesso falso', () => {
    const gate = getImportGate({ isPremium: false, importsThisMonth: 1, lastSuccess: { imported: 0, ignored: 8 } });
    expect(gate.showLimitBlock).toBe(true);
    expect(gate.successOnly).toBe(false);
  });

  it('a regra comercial segue em 1 importação por mês', () => {
    expect(getImportGate({ isPremium: false, importsThisMonth: 0 }).quotaExhausted).toBe(false);
    expect(getImportGate({ isPremium: false, importsThisMonth: 1 }).quotaExhausted).toBe(true);
  });
});

describe('ImportView usa o gate em vez de esconder o sucesso', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/components/views/ImportView.tsx'), 'utf8');

  it('o bloqueio só aparece quando não há sucesso recente, e o painel recebe o estado da cota', () => {
    expect(src).toContain('getImportGate(');
    expect(src).toContain('gate.showLimitBlock');
    expect(src).toContain('gate.successOnly');
    expect(src).toContain('canImportAnother={gate.canImportAnother}');
    expect(src).not.toMatch(/hasReachedLimit \? \(/);
  });

  it('o gate mensal continua barrando uma nova tentativa de importação', () => {
    expect(src).toMatch(/if \(gate\.quotaExhausted\) \{\s*void trackProductEvent\('import_failed', \{ stage: 'quota' \}\)/);
  });
});
