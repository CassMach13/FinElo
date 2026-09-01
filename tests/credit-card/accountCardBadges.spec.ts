import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * O card de conta tem MAIS DE UM ramo de layout — um compacto e um expandido —, e
 * ambos desenham o mesmo cabeçalho de fatura.
 *
 * Ao introduzir o selo «A CONCILIAR» eu o adicionei em apenas um deles. Os testes
 * de unidade passaram, porque a lógica que decide o selo estava certa; só o
 * desenho de um dos ramos ficou de fora. O erro só apareceu olhando a tela em
 * staging, onde o ramo compacto é justamente o que renderiza.
 *
 * Este teste é a rede que faltava: onde houver o selo de vencida, tem de haver
 * também o de conciliação. Se um terceiro ramo de layout surgir, ele falha.
 */

const currentDir = dirname(fileURLToPath(import.meta.url));
const componente = readFileSync(
  join(currentDir, '../../src/components/transactions/AccountBalanceCard.tsx'),
  'utf-8'
);

const ocorrencias = (padrao: RegExp) => (componente.match(padrao) ?? []).length;

describe('selos do card de conta', () => {
  it('todo ramo de layout que desenha VENCIDA também desenha A CONCILIAR', () => {
    const vencida = ocorrencias(/faturaVencida && \(/g);
    const conciliar = ocorrencias(/!faturaVencida && reconciliacaoPendente && \(/g);

    expect(vencida).toBeGreaterThan(0);
    expect(conciliar).toBe(vencida);
  });

  it('os dois ramos usam o mesmo texto de selo', () => {
    expect(ocorrencias(/A CONCILIAR/g)).toBe(ocorrencias(/VENCIDA\s*<\/span>/g));
  });

  it('o selo de conciliação é subordinado ao de vencida', () => {
    // Nunca os dois ao mesmo tempo: com dívida vencida, quem governa é ela.
    expect(componente).not.toMatch(/reconciliacaoPendente && \(\s*<span[^>]*rose-/);
    expect(ocorrencias(/!faturaVencida && reconciliacaoPendente/g)).toBeGreaterThan(0);
  });

  it('o selo tem texto explicativo acessível ao passar o mouse', () => {
    const titulos = ocorrencias(/title="Há diferença entre o extrato e os pagamentos/g);
    expect(titulos).toBe(ocorrencias(/A CONCILIAR/g));
  });

  it('o campo de conciliação chega ao componente pela interface tipada', () => {
    expect(componente).toMatch(/reconciliacaoPendente\?: boolean;/);
    expect(componente).toMatch(/reconciliacaoPendente = false,/);
  });
});
