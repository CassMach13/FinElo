import { describe, expect, it } from 'vitest';
import {
  getDistinctCardImportReferenceMonths,
  resolveAutomaticCardReferenceMonth,
  resolveCardImportCycleCoordinates,
} from '../../src/utils/cardImportReference';

describe('competência automática de importação do cartão', () => {
  it('usa a compra mais recente e ignora pagamento posterior', () => {
    const transactions = [
      { Data: '2026-07-15', Valor: -120, Tipo: 'Despesa' },
      { Data: '2026-08-02', Valor: 120, Tipo: 'Renda' },
    ];

    expect(getDistinctCardImportReferenceMonths(transactions)).toEqual(['2026-07', '2026-08']);
    expect(resolveAutomaticCardReferenceMonth(transactions)).toBe('2026-07');
  });

  it('preserva o mês de uma data ISO sem deslocamento de fuso horário', () => {
    expect(
      resolveAutomaticCardReferenceMonth([{ Data: '2026-08-01', Valor: -10, Tipo: 'Despesa' }])
    ).toBe('2026-08');
  });

  it('sugere o mes anterior ao vencimento mesmo com compras depois da virada do mes', () => {
    const transactions = [
      { Data: '2026-06-25', Valor: -80, Tipo: 'Despesa' },
      { Data: '2026-07-02', Valor: -45, Tipo: 'Despesa' },
      { Data: '2026-07-03', Valor: -20, Tipo: 'Despesa' },
    ];

    expect(resolveAutomaticCardReferenceMonth(transactions, '2026-07-10')).toBe('2026-06');
  });

  /**
   * ===========================================================================
   * REGRESSÃO — arquivo Nubank real mal rotulado
   * ===========================================================================
   *
   * `Nubank_2026-06-18.csv`: compras de 11/mai a 09/jun. O algoritmo antigo
   * escolhia "o mês civil da linha mais recente" e etiquetava a competência
   * inteira como junho — sempre errado quando o ciclo atravessa a virada do
   * mês, que é a regra, não a exceção, para qualquer fechamento que não seja
   * no último dia do mês.
   *
   * Na conta real, isso fez R$ 3.663,38 de pagamento (que a convenção do
   * arquivo seguinte reatribuiria a esta competência) caírem numa competência
   * fantasma "2026-05" que o sistema descarta por não ter fatura própria — o
   * dinheiro simplesmente desaparecia do modelo inteiro, e a fatura de abril
   * (a competência anterior) aparecia como "nenhum pagamento encontrado" por
   * R$ 5.163,37 que na verdade tinham sido pagos.
   */
  it('respeita o ciclo de fechamento, não o mês civil da linha mais recente', () => {
    const arquivoMalRotuladoSemFechamento = [
      { Data: '2026-05-11', Valor: -359.32, Tipo: 'Despesa' },
      { Data: '2026-05-20', Valor: -120.5, Tipo: 'Despesa' },
      { Data: '2026-06-01', Valor: -80.0, Tipo: 'Despesa' },
      { Data: '2026-06-08', Valor: -359.32, Tipo: 'Despesa' },
      { Data: '2026-06-09', Valor: -6.89, Tipo: 'Despesa' },
    ];

    // Sem saber o dia de fechamento, o comportamento antigo é preservado —
    // não há como fazer melhor sem essa informação.
    expect(resolveAutomaticCardReferenceMonth(arquivoMalRotuladoSemFechamento)).toBe('2026-06');

    // Com o fechamento real da conta (dia 11), a competência é maio — a
    // fatura fechou em 11/06, então tudo que a compõe é o ciclo de maio.
    expect(resolveAutomaticCardReferenceMonth(arquivoMalRotuladoSemFechamento, null, 11)).toBe(
      '2026-05'
    );
  });

  it('a primeira e a última data do arquivo concordam na mesma competência', () => {
    // As duas pontas do arquivo, isoladas: se a regra for sólida, as duas
    // devem apontar para a mesma competência sozinhas, sem precisar da outra.
    expect(
      resolveAutomaticCardReferenceMonth(
        [{ Data: '2026-05-11', Valor: -1, Tipo: 'Despesa' }],
        null,
        11
      )
    ).toBe('2026-05');
    expect(
      resolveAutomaticCardReferenceMonth(
        [{ Data: '2026-06-09', Valor: -1, Tipo: 'Despesa' }],
        null,
        11
      )
    ).toBe('2026-05');
  });

  /**
   * A regra generaliza: testada contra as pontas (primeira/última data) das
   * 5 faturas reais da conta piloto, fechamento dia 11 — incluindo as 4 que
   * JÁ estavam corretas, para provar que a correção não quebra o que
   * funcionava.
   */
  it.each([
    ['2026-01-16', '2026-02-09', '2026-01'],
    ['2026-02-14', '2026-03-09', '2026-02'],
    ['2026-03-11', '2026-04-10', '2026-03'],
    ['2026-04-13', '2026-05-10', '2026-04'],
    ['2026-05-11', '2026-06-09', '2026-05'],
  ])('ciclo %s a %s -> competência %s (fechamento dia 11)', (primeira, ultima, esperado) => {
    const linhas = [
      { Data: primeira, Valor: -1, Tipo: 'Despesa' },
      { Data: ultima, Valor: -1, Tipo: 'Despesa' },
    ];
    expect(resolveAutomaticCardReferenceMonth(linhas, null, 11)).toBe(esperado);
  });

  it('o vencimento continua tendo prioridade sobre o ciclo de fechamento', () => {
    // Quando existe vencimento conhecido, ele decide sozinho — o fechamento
    // nem é consultado. As duas fontes nunca disputam.
    const transactions = [
      { Data: '2026-06-25', Valor: -80, Tipo: 'Despesa' },
      { Data: '2026-07-03', Valor: -20, Tipo: 'Despesa' },
    ];
    expect(resolveAutomaticCardReferenceMonth(transactions, '2026-07-10', 11)).toBe('2026-06');
  });

  it('sem fechamento nem vencimento, preserva o comportamento anterior', () => {
    // Ninguém que já dependia do "mês mais recente" quebra: o parâmetro é
    // aditivo, não uma mudança de comportamento por padrão.
    const transactions = [
      { Data: '2026-07-15', Valor: -120, Tipo: 'Despesa' },
      { Data: '2026-08-02', Valor: 120, Tipo: 'Renda' },
    ];
    expect(resolveAutomaticCardReferenceMonth(transactions)).toBe('2026-07');
  });

  it('mantem competencia manual e vencimento em eixos independentes', () => {
    expect(
      resolveCardImportCycleCoordinates({
        referenceLabel: '2026-06',
        dueDate: '2026-07-10',
      })
    ).toEqual({
      purchaseReferenceLabel: '2026-06',
      dueYear: 2026,
      dueMonth: 7,
      dueDate: '2026-07-10',
    });
  });

  it('preserva o caso explicito de competencia e vencimento no mesmo mes', () => {
    expect(
      resolveCardImportCycleCoordinates({
        referenceLabel: '2026-07',
        dueDate: '2026-07-28',
      })
    ).toEqual({
      purchaseReferenceLabel: '2026-07',
      dueYear: 2026,
      dueMonth: 7,
      dueDate: '2026-07-28',
    });
  });

  it('recusa data calendaria invalida sem inventar vencimento', () => {
    expect(
      resolveCardImportCycleCoordinates({
        referenceLabel: '2026-06',
        dueDate: '2026-02-31',
      })
    ).toEqual({
      purchaseReferenceLabel: '2026-06',
      dueYear: 2026,
      dueMonth: 6,
    });
  });
});
