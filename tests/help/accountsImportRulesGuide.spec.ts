import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HelpArticleContent from '../../src/components/help/HelpArticleContent';
import { HELP_TOPICS, getNavigateLabel } from '../../src/data/helpCenterContent';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const topic = (id: string) => HELP_TOPICS.find((item) => item.id === id)!;
const text = (id: string) => topic(id).answer + JSON.stringify(topic(id).article);
const ids = ['set-accounts', 'set-import-history', 'import-rules'];

describe('Ajuda — contas, histórico de importações e regras', () => {
  it('moderniza os IDs existentes e renderiza os três artigos sem inventar screenshots', () => {
    ids.forEach((id) => {
      expect(HELP_TOPICS.filter((item) => item.id === id)).toHaveLength(1);
      const article = topic(id).article!;
      expect(article.steps!.length).toBeGreaterThanOrEqual(3);
      const html = renderToStaticMarkup(React.createElement(HelpArticleContent, { article }));
      expect(html).toContain('<ol');
      expect(html).not.toContain('<img');
    });
  });

  it('os CTAs levam a Configurações, inclusive a resposta curta de corrigir conta', () => {
    [...ids, 'set-reassign'].forEach((id) => {
      expect(topic(id).action).toBe('navigate');
      expect(getNavigateLabel(topic(id).navigateTo!)).toBe('Ir para Configurações');
    });
  });

  it('contas: usa os campos e tipos reais, distingue saldo bancário de limite utilizado', () => {
    const modal = read('src/components/views/AccountModal.tsx');
    const settings = read('src/components/views/SettingsView.tsx');
    ['Nome da Conta', 'Tipo da Conta', 'Banco/Instituição', 'Saldo Inicial', 'Data do Saldo/Gasto Inicial',
      'Conta Corrente', 'Poupança', 'Investimento', 'Cartão de Crédito', 'Cartão Alimentação',
      'Dinheiro em Espécie', 'Outro', 'Editar Conta'].forEach((label) => {
      expect(text('set-accounts'), label).toContain(label);
      expect(modal, label).toContain(label);
    });
    expect(settings).toContain('Gerenciar Contas');
    expect(text('set-accounts')).toContain('não é dinheiro disponível');
    expect(text('set-accounts')).toContain('data inicial anterior ao primeiro lançamento');
    expect(text('set-accounts')).toContain('não move nem exclui');
    expect(text('set-accounts')).toContain('Não existe uma seleção de conta padrão');
  });

  it('arquivar mantém histórico, excluir conta exige ausência de transações', () => {
    const txt = text('set-accounts');
    expect(txt).toContain('Arquivar** mantém o histórico');
    expect(txt).toContain('bloqueado se houver transações vinculadas');
    expect(txt).toContain('não apague lançamentos apenas para liberar');
    const store = read('src/hooks/useAppStore.ts');
    expect(store).toContain('has_transactions');
  });

  it('histórico: consulta não equivale a transações atuais e usa rótulos reais', () => {
    const settings = read('src/components/views/SettingsView.tsx');
    ['Histórico de Importações', 'Arquivo', 'Conta Escolhida', 'Data da Importação',
      'Total', 'Importados', 'Ignorados', 'Alertas', 'Exibir'].forEach((label) => {
      expect(text('set-import-history'), label).toContain(label);
      expect(settings, label).toContain(label);
    });
    const txt = text('set-import-history');
    expect(txt).toContain('Histórico não é a lista atual de transações');
    expect(txt).toContain('Exibir não altera dados');
    expect(txt).toContain('Excluída');
    expect(txt).toContain('Sem ID legado');
  });

  it('mover e excluir alertam sobre lançamentos, nomes homônimos e ausência de Desfazer', () => {
    const txt = text('set-import-history');
    ['Mover transações para a conta', 'Aplicar Correção', 'Excluir Tudo', 'não oferece Desfazer',
      'pode mudar os saldos', 'outros lotes homônimos', 'não prossiga se o alcance estiver incerto'].forEach((warning) =>
      expect(txt, warning).toContain(warning));
    expect(topic('set-reassign').answer).toContain('não só o histórico');
    expect(topic('set-reassign').answer).toContain('Não há Desfazer');
    expect(txt).not.toContain('Só o lote repetido some');
  });

  it('competência por arquivo aponta para o local existente e não promete reconstrução', () => {
    const txt = text('set-import-history');
    expect(txt).toContain('Transações → Histórico');
    expect(txt).toContain('Ajustar competências por arquivo');
    expect(txt).toContain('Salvar competências');
    expect(txt).toContain('sem mover, excluir ou recriar');
    expect(txt).toContain(topic('import-competence').title);
    expect(read('src/components/modals/CreditCardInvoiceCyclesModal.tsx')).toContain('Salvar competências');
  });

  it('reidratação e sincronização não são recuperação de arquivos ou transações excluídas', () => {
    const txt = text('set-import-history');
    expect(txt).toContain('Reidratar histórico de importações');
    expect(txt).toContain('a partir dos lançamentos atuais');
    expect(txt).toContain('Não altera esses lançamentos');
    expect(txt).toContain('não restaura transações excluídas');
    expect(txt).toContain('Sincronizar Histórico Antigo');
    expect(txt).toContain('não necessariamente do dia do upload');
  });

  it('regras: condição e ações reais, retroatividade explícita e sem prioridade inventada', () => {
    const modal = read('src/components/modals/MappingRuleModal.tsx');
    const txt = text('import-rules');
    ['Se a descrição contiver o texto:', 'Alterar Descrição Para:', 'Classificar Como:',
      'Vincular a Patrimônio (Opcional):'].forEach((label) => {
      expect(txt, label).toContain(label);
      expect(modal, label).toContain(label);
    });
    expect(txt).toContain('não apenas importações futuras');
    expect(txt).toContain('valor, data, conta e descrição original não são alterados');
    expect(txt).toContain('Excluir uma regra não desfaz');
    expect(txt).toContain('Não há prioridade configurável');
    expect(txt).toContain('Re-aplicar Todas as Regras');
    expect(txt).toContain('não as remove automaticamente');
    expect(txt).toContain('TRANSPORTE EXEMPLO');
    expect(txt).not.toMatch(/regex|expressão regular|só em novas importações/i);
  });
});
