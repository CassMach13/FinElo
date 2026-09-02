import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Os selos do cabeçalho de fatura, e as duas dimensões que eles representam.
 *
 * VENCIDA fala do LIVRO 1: existe obrigação econômica em aberto cujo vencimento
 * já passou. A CONCILIAR fala do LIVRO 2: existe diferença entre o extrato e os
 * pagamentos cuja natureza ainda não foi provada.
 *
 * São perguntas diferentes, e por um tempo uma escondia a outra: o selo de
 * conciliação só aparecia quando `!faturaVencida`. O efeito era bloquear um
 * fluxo real — numa conta com fatura vencida o usuário não tinha caminho nenhum
 * para resolver a divergência, ainda que ela existisse. Agora VENCIDA continua
 * sendo o estado principal, e A CONCILIAR aparece ao lado como secundário.
 *
 * O card tem MAIS DE UM ramo de layout — um compacto e um expandido — e ambos
 * desenham este cabeçalho. Ao introduzir o selo eu o coloquei em apenas um
 * deles; os testes de unidade passaram, porque a lógica estava certa, e o erro
 * só apareceu olhando a tela em staging. Daí os contadores por ramo.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const componente = readFileSync(
  join(currentDir, '../../src/components/transactions/AccountBalanceCard.tsx'),
  'utf-8'
);

const ocorrencias = (padrao: RegExp) => (componente.match(padrao) ?? []).length;

/** Quantos ramos de layout desenham o cabeçalho de fatura. */
const RAMOS = ocorrencias(/\{faturaVencida && \(/g);

describe('as duas dimensões são independentes', () => {
  /**
   * CASO 1 — dívida vencida sem reconciliação: VENCIDA, sem A CONCILIAR.
   * CASO 3 — dívida vencida COM reconciliação: as duas ao mesmo tempo.
   *
   * As duas asserções são a mesma estrutura: a condição do selo de conciliação
   * não pode mencionar `faturaVencida`. Se mencionasse, uma decidiria a outra.
   */
  it('o selo de conciliação não depende do estado de vencida', () => {
    expect(RAMOS).toBeGreaterThan(0);
    expect(ocorrencias(/\{reconciliacaoPendente && \(/g)).toBe(RAMOS);
    expect(componente, 'a supressão por vencida voltou').not.toMatch(/!faturaVencida/);
  });

  /** CASO 3 — o acesso ao fluxo também não pode ser suprimido. */
  it('o acesso ao fluxo não depende do estado de vencida', () => {
    const acesso = ocorrencias(
      /\{\(reconciliacaoPendente \|\| reconciliacaoResolvida\) && reconciliacaoReferenceMonth && onOpenReconciliation && \(/g
    );
    expect(acesso).toBe(RAMOS);
  });

  /** VENCIDA continua sendo o estado principal: vem primeiro na leitura. */
  it('VENCIDA é desenhada antes de A CONCILIAR', () => {
    const posVencida = componente.indexOf('{faturaVencida && (');
    const posConciliar = componente.indexOf('{reconciliacaoPendente && (');

    expect(posVencida).toBeGreaterThan(-1);
    expect(posConciliar).toBeGreaterThan(posVencida);
  });

  /** CASO 2 — reconciliação sem dívida vencida continua funcionando. */
  it('a reconciliação aparece sozinha quando não há dívida vencida', () => {
    // Nada na condição do selo exige `faturaVencida` em nenhum sentido.
    const condicoes = componente.match(/\{reconciliacaoPendente && \(/g) ?? [];
    expect(condicoes.length).toBe(RAMOS);
    for (const c of condicoes) expect(c).not.toContain('faturaVencida');
  });

  /**
   * CASO 4 — resolvida a reconciliação, `reconciliacaoPendente` fica falso e o
   * selo some. O ACESSO permanece enquanto houver resolução gravada, para o
   * usuário poder desfazer; VENCIDA segue seu próprio critério, intocada.
   */
  it('o selo sai quando não há mais pendência, e o acesso permanece', () => {
    expect(componente).toMatch(/\{reconciliacaoPendente && \(/);
    expect(componente).toMatch(
      /\(reconciliacaoPendente \|\| reconciliacaoResolvida\) && reconciliacaoReferenceMonth/
    );
    expect(componente).toMatch(/reconciliacaoPendente \? 'Ver diferença' : 'Conciliação'/);
  });

  it('VENCIDA não passa a depender de reconciliação', () => {
    const condicoes = componente.match(/\{faturaVencida && \(/g) ?? [];
    expect(condicoes.length).toBe(RAMOS);
    for (const c of condicoes) expect(c).not.toContain('reconciliacao');
  });
});

describe('todos os ramos de layout desenham o mesmo cabeçalho', () => {
  it('os dois selos existem em cada ramo', () => {
    expect(ocorrencias(/A CONCILIAR/g)).toBe(RAMOS);
    expect(ocorrencias(/VENCIDA\s*<\/span>/g)).toBe(RAMOS);
  });

  it('o selo tem texto explicativo acessível ao passar o mouse', () => {
    expect(ocorrencias(/title="Há diferença entre o extrato e os pagamentos/g)).toBe(RAMOS);
  });

  it('o botão de acesso existe em cada ramo', () => {
    expect(ocorrencias(/'Ver diferença' : 'Conciliação'/g)).toBe(RAMOS);
  });
});

describe('a interface tipada', () => {
  it('os campos de conciliação chegam pelo display', () => {
    expect(componente).toMatch(/reconciliacaoPendente\?: boolean;/);
    expect(componente).toMatch(/reconciliacaoPendente = false,/);
    expect(componente).toMatch(/reconciliacaoResolvida\?: boolean;/);
    expect(componente).toMatch(/reconciliacaoReferenceMonth\?: string \| null;/);
  });
});
