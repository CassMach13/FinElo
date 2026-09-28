import { describe, expect, it } from 'vitest';
import {
  PARCELA_DESCONHECIDA,
  SEM_PARCELAMENTO,
  formatInstallmentCell,
} from '../../src/domain/installments/installmentDisplay';

/**
 * Chamado 20260905-9C10: a coluna "Parc." exibia "1/1" para transação sem
 * parcelamento, porque a célula montava o texto com
 * `${Parcela_Atual || 1}/${Total_Parcelas || 1}`.
 *
 * O caso que dá nome ao chamado é o B: em produção ~5.600 de 6.109 transações
 * caíam nele.
 */
describe('formatInstallmentCell — coluna "Parc."', () => {
  describe('A. parcela válida é exibida como está', () => {
    it('3 de 10 vira "3/10"', () => {
      expect(formatInstallmentCell(3, 10)).toBe('3/10');
    });

    it('1 de 4 vira "1/4"', () => {
      expect(formatInstallmentCell(1, 4)).toBe('1/4');
    });

    it('última parcela vira "10/10"', () => {
      expect(formatInstallmentCell(10, 10)).toBe('10/10');
    });

    it('plano longo de fatura vira "12/12"', () => {
      expect(formatInstallmentCell(12, 12)).toBe('12/12');
    });
  });

  describe('B. transação sem parcelamento não pode virar "1/1"', () => {
    it('null/null não exibe parcela', () => {
      expect(formatInstallmentCell(null, null)).toBe(SEM_PARCELAMENTO);
    });

    it('undefined/undefined não exibe parcela', () => {
      expect(formatInstallmentCell(undefined, undefined)).toBe(SEM_PARCELAMENTO);
    });

    it('nunca devolve "1/1" quando não há dado algum', () => {
      for (const par of [
        [null, null],
        [undefined, undefined],
        [null, undefined],
        [undefined, null],
      ] as const) {
        expect(formatInstallmentCell(par[0], par[1])).not.toBe('1/1');
      }
    });
  });

  describe('C. legado 0/0 conta como ausente', () => {
    it('0/0 não exibe parcela', () => {
      expect(formatInstallmentCell(0, 0)).toBe(SEM_PARCELAMENTO);
    });

    it('0/0 não vira "1/1"', () => {
      expect(formatInstallmentCell(0, 0)).not.toBe('1/1');
    });

    it('0/0 não vira "0/0"', () => {
      // 0 nunca é gravado de propósito: `handleSave` faz `parseInt || undefined`
      // e o extrator de marcador recusa zero. Exibir "0/0" daria ao ruído da
      // seed `demo.csv` a aparência de informação.
      expect(formatInstallmentCell(0, 0)).not.toBe('0/0');
    });
  });

  describe('D. 1/1 gravado é dado, e continua visível', () => {
    it('1/1 é exibido', () => {
      // O fluxo manual não produz isto (número de parcelas validado com
      // `count < 2` → erro), mas `extractInstallments` produz quando a
      // descrição termina em "(1/1)". Ocultar seria mudar a semântica do
      // produto, e as superfícies não são unânimes: o badge da visão em
      // cartões esconde, a linha de detalhe e a exportação mostram.
      expect(formatInstallmentCell(1, 1)).toBe('1/1');
    });

    it('distingue "1/1" gravado de campo vazio', () => {
      expect(formatInstallmentCell(1, 1)).not.toBe(formatInstallmentCell(null, null));
    });
  });

  describe('E. par incompleto não se disfarça de parcela válida', () => {
    it('atual sem total vira "3/?"', () => {
      expect(formatInstallmentCell(3, null)).toBe(`3/${PARCELA_DESCONHECIDA}`);
    });

    it('total sem atual vira "?/10"', () => {
      expect(formatInstallmentCell(null, 10)).toBe(`${PARCELA_DESCONHECIDA}/10`);
    });

    it('atual sem total não vira "3/1", como o fallback antigo fazia', () => {
      expect(formatInstallmentCell(3, null)).not.toBe('3/1');
      expect(formatInstallmentCell(3, undefined)).not.toBe('3/1');
    });

    it('total sem atual não vira "1/10"', () => {
      expect(formatInstallmentCell(null, 10)).not.toBe('1/10');
      expect(formatInstallmentCell(undefined, 10)).not.toBe('1/10');
    });

    it('zero de um lado é tratado como ausente, não como parcela', () => {
      expect(formatInstallmentCell(0, 5)).toBe(`${PARCELA_DESCONHECIDA}/5`);
      expect(formatInstallmentCell(5, 0)).toBe(`5/${PARCELA_DESCONHECIDA}`);
    });

    it('par incompleto é distinguível tanto de vazio quanto de parcela válida', () => {
      const incompleto = formatInstallmentCell(3, null);
      expect(incompleto).not.toBe(SEM_PARCELAMENTO);
      expect(incompleto).not.toBe('3/3');
      expect(incompleto).toContain(PARCELA_DESCONHECIDA);
    });
  });

  describe('valores fora de faixa não são promovidos a parcela', () => {
    it('negativos contam como ausentes', () => {
      expect(formatInstallmentCell(-1, -3)).toBe(SEM_PARCELAMENTO);
      expect(formatInstallmentCell(-1, 3)).toBe(`${PARCELA_DESCONHECIDA}/3`);
    });

    it('NaN conta como ausente', () => {
      expect(formatInstallmentCell(Number.NaN, Number.NaN)).toBe(SEM_PARCELAMENTO);
      expect(formatInstallmentCell(Number.NaN, 6)).toBe(`${PARCELA_DESCONHECIDA}/6`);
    });

    it('fracionário conta como ausente', () => {
      expect(formatInstallmentCell(1.5, 3)).toBe(`${PARCELA_DESCONHECIDA}/3`);
    });

    it('Infinity conta como ausente', () => {
      expect(formatInstallmentCell(Number.POSITIVE_INFINITY, 3)).toBe(`${PARCELA_DESCONHECIDA}/3`);
    });
  });

  describe('pares incoerentes são exibidos como estão, não silenciosamente corrigidos', () => {
    it('atual maior que o total continua visível', () => {
      // Só chega aqui por edição manual: o extrator recusa `current > total`.
      // Exibir "5/3" mostra o problema; normalizar para "3/3" o esconderia.
      expect(formatInstallmentCell(5, 3)).toBe('5/3');
    });
  });

  describe('contrato de apresentação', () => {
    it('o rótulo de vazio é o mesmo que a tabela já usa nas outras colunas', () => {
      expect(SEM_PARCELAMENTO).toBe('-');
    });

    it('sempre devolve string não vazia', () => {
      const pares: Array<[number | null | undefined, number | null | undefined]> = [
        [3, 10], [1, 1], [null, null], [0, 0], [3, null], [null, 10], [5, 3],
      ];
      for (const [atual, total] of pares) {
        const saida = formatInstallmentCell(atual, total);
        expect(typeof saida).toBe('string');
        expect(saida.length).toBeGreaterThan(0);
      }
    });
  });
});
