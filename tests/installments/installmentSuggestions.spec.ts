import { describe, expect, it } from 'vitest';
import {
  aplicarEscolhasDeParcela,
  construirSugestoesDeParcela,
  encontrarCandidatosDeParcelaIrma,
  podePreSugerir,
  type ParcelaImportada,
} from '../../src/domain/installments/installmentSuggestions';
import type { Transaction } from '../../src/types';

/**
 * Chamado do usuário: ao importar a parcela 2/X ou posterior, sugerir a
 * descrição/categoria que ele já usou na parcela irmã — porque em lojas onde
 * o texto muda a cada compra (Amazon) nenhuma regra de mapeamento fixa
 * resolve, e ele reclassifica a mesma compra uma vez por mês.
 *
 * O módulo é uma CONSULTA: devolve candidatos, nunca decide nem escreve.
 */

const CONTA = 'conta-cartao';
const OUTRA_CONTA = 'conta-outra';

let seq = 0;
const existente = (over: Partial<Transaction>): Transaction => {
  seq += 1;
  return {
    ID_Transacao: `t-${seq}`,
    ID_Conta: CONTA,
    Data: new Date(2026, 0, 15),
    Descricao_Original: 'AMAZON *ALGO',
    Nome_Fantasia: 'Amazon',
    Valor: -100,
    Tipo: 'Despesa',
    Categoria: 'Compras',
    Origem: 'fatura.csv',
    Fonte: 'Cartão',
    Parcela_Atual: 1,
    Total_Parcelas: 6,
    ...over,
  } as Transaction;
};

const importada = (over: Partial<ParcelaImportada> = {}): ParcelaImportada => ({
  Descricao_Original: 'AMAZON *OUTRO TEXTO',
  Nome_Fantasia: 'AMAZON *OUTRO TEXTO',
  Valor: -100,
  Parcela_Atual: 2,
  Total_Parcelas: 6,
  Data: new Date(2026, 1, 15),
  ...over,
});

describe('encontra a parcela irmã correta', () => {
  it('1. a parcela 2/6 encontra exatamente a 1/6', () => {
    const candidatos = encontrarCandidatosDeParcelaIrma(
      importada(),
      CONTA,
      [existente({ Parcela_Atual: 1, Nome_Fantasia: 'Amazon — Livro', Categoria: 'Cursos' })]
    );

    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].nomeFantasia).toBe('Amazon — Livro');
    expect(candidatos[0].categoria).toBe('Cursos');
    expect(candidatos[0].confianca).toBe('exata');
  });

  it('2. a parcela 3/6 encontra a 2/6, e NÃO a 1/6', () => {
    // A continuidade imediata é o que separa dois planos concorrentes —
    // "qualquer parcela anterior" juntaria compras diferentes.
    const candidatos = encontrarCandidatosDeParcelaIrma(
      importada({ Parcela_Atual: 3, Data: new Date(2026, 2, 15) }),
      CONTA,
      [
        existente({ Parcela_Atual: 1, Nome_Fantasia: 'Primeira', Data: new Date(2026, 0, 15) }),
        existente({ Parcela_Atual: 2, Nome_Fantasia: 'Segunda', Data: new Date(2026, 1, 15) }),
      ]
    );

    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].nomeFantasia).toBe('Segunda');
    expect(candidatos[0].parcelaAtual).toBe(2);
  });

  it('8. a parcela 1/X não roda o mecanismo — não existe irmã anterior', () => {
    expect(
      encontrarCandidatosDeParcelaIrma(
        importada({ Parcela_Atual: 1 }),
        CONTA,
        [existente({ Parcela_Atual: 0 })]
      )
    ).toEqual([]);
  });

  it('uma compra à vista (sem parcela) nunca entra no mecanismo', () => {
    expect(
      encontrarCandidatosDeParcelaIrma(
        importada({ Parcela_Atual: null, Total_Parcelas: null }),
        CONTA,
        [existente({})]
      )
    ).toEqual([]);
  });
});

describe('o que NÃO pode virar candidato', () => {
  it('4. conta diferente não candidata', () => {
    expect(
      encontrarCandidatosDeParcelaIrma(importada(), CONTA, [existente({ ID_Conta: OUTRA_CONTA })])
    ).toEqual([]);
  });

  it('5. Total_Parcelas diferente não candidata', () => {
    // 1/6 e 1/10 podem ter o mesmo valor por coincidência e serem compras
    // completamente diferentes.
    expect(
      encontrarCandidatosDeParcelaIrma(importada(), CONTA, [existente({ Total_Parcelas: 10 })])
    ).toEqual([]);
  });

  it('6. valor diferente não vira candidato forte', () => {
    expect(
      encontrarCandidatosDeParcelaIrma(importada({ Valor: -100 }), CONTA, [existente({ Valor: -250 })])
    ).toEqual([]);
  });

  it('uma parcela cronologicamente POSTERIOR não candidata', () => {
    // A irmã tem que ser passado; do contrário a sugestão viria do futuro.
    expect(
      encontrarCandidatosDeParcelaIrma(
        importada({ Data: new Date(2026, 0, 10) }),
        CONTA,
        [existente({ Parcela_Atual: 1, Data: new Date(2026, 5, 10) })]
      )
    ).toEqual([]);
  });

  it('sem conta definida, o mecanismo não roda', () => {
    expect(encontrarCandidatosDeParcelaIrma(importada(), null, [existente({})])).toEqual([]);
  });
});

describe('7. diferença de R$ 0,01 — candidato secundário', () => {
  it('um centavo de diferença ainda é candidato, mas de menor confiança', () => {
    // R$ 100 em 3x = 33,33 + 33,33 + 33,34. O centavo é arredondamento do
    // próprio plano, não «valor parecido».
    const candidatos = encontrarCandidatosDeParcelaIrma(
      importada({ Valor: -33.34, Parcela_Atual: 3, Total_Parcelas: 3, Data: new Date(2026, 2, 15) }),
      CONTA,
      [existente({ Valor: -33.33, Parcela_Atual: 2, Total_Parcelas: 3, Data: new Date(2026, 1, 15) })]
    );

    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].confianca).toBe('centavo');
  });

  it('dois centavos já é longe demais — não candidata', () => {
    expect(
      encontrarCandidatosDeParcelaIrma(importada({ Valor: -100.02 }), CONTA, [existente({ Valor: -100 })])
    ).toEqual([]);
  });

  it('a tolerância é absoluta, não percentual — R$ 1,00 em conta de R$ 5.000 não candidata', () => {
    expect(
      encontrarCandidatosDeParcelaIrma(importada({ Valor: -5000 }), CONTA, [existente({ Valor: -4999 })])
    ).toEqual([]);
  });

  it('o candidato exato sempre vem antes do de centavo', () => {
    const candidatos = encontrarCandidatosDeParcelaIrma(importada({ Valor: -100 }), CONTA, [
      existente({ Valor: -100.01, Nome_Fantasia: 'De centavo' }),
      existente({ Valor: -100, Nome_Fantasia: 'Exata' }),
    ]);

    expect(candidatos.map((c) => c.nomeFantasia)).toEqual(['Exata', 'De centavo']);
    expect(candidatos[0].confianca).toBe('exata');
  });
});

describe('3. dois planos concorrentes — regressão do caso real', () => {
  /**
   * Encontrado em produção: SEIS lançamentos batendo em (mesma conta,
   * Total_Parcelas = 4, valor = R$ 50,00) — mais linhas do que um plano de 4x
   * comporta. São dois planos diferentes que coincidem em valor e prazo.
   *
   * O mecanismo tem que devolver os dois e NUNCA escolher sozinho.
   */
  const doisPlanos = [
    existente({
      Parcela_Atual: 1, Total_Parcelas: 4, Valor: -50,
      Nome_Fantasia: 'Plano A', Categoria: 'Contas', Data: new Date(2026, 0, 5),
    }),
    existente({
      Parcela_Atual: 1, Total_Parcelas: 4, Valor: -50,
      Nome_Fantasia: 'Plano B', Categoria: 'Lazer', Data: new Date(2026, 0, 20),
    }),
  ];

  const nova = importada({ Parcela_Atual: 2, Total_Parcelas: 4, Valor: -50, Data: new Date(2026, 1, 10) });

  it('devolve os dois candidatos, não um', () => {
    const candidatos = encontrarCandidatosDeParcelaIrma(nova, CONTA, doisPlanos);
    expect(candidatos).toHaveLength(2);
    expect(candidatos.map((c) => c.categoria).sort()).toEqual(['Contas', 'Lazer']);
  });

  it('NUNCA pré-sugere sozinho quando há mais de um', () => {
    const [sugestao] = construirSugestoesDeParcela([nova], CONTA, doisPlanos);
    expect(podePreSugerir(sugestao)).toBe(false);
  });

  it('a escolha oferece o que o usuário precisa para decidir', () => {
    const [sugestao] = construirSugestoesDeParcela([nova], CONTA, doisPlanos);

    for (const c of sugestao.candidatos) {
      expect(c.nomeFantasia).toBeTruthy();
      expect(c.categoria).toBeTruthy();
      expect(Number.isFinite(c.valor)).toBe(true);
      expect(c.parcelaAtual).toBe(1);
      expect(c.totalParcelas).toBe(4);
      expect(c.data).toBeInstanceOf(Date);
    }
  });
});

describe('9. zero candidatos — o fluxo de hoje fica intacto', () => {
  it('nada a perguntar quando não há irmã', () => {
    expect(construirSugestoesDeParcela([importada()], CONTA, [])).toEqual([]);
  });

  it('só as parcelas COM candidato entram na lista', () => {
    const novas = [
      importada({ Nome_Fantasia: 'sem irmã', Valor: -777 }),
      importada({ Nome_Fantasia: 'com irmã', Valor: -100 }),
    ];
    const sugestoes = construirSugestoesDeParcela(novas, CONTA, [existente({ Valor: -100 })]);

    expect(sugestoes).toHaveLength(1);
    // O índice aponta para a posição no lote — é a chave de aplicação.
    expect(sugestoes[0].indice).toBe(1);
  });

  it('um candidato só pode ser pré-sugerido', () => {
    const [sugestao] = construirSugestoesDeParcela([importada()], CONTA, [existente({})]);
    expect(podePreSugerir(sugestao)).toBe(true);
  });
});

describe('11. aplicar a escolha copia SÓ descrição e categoria', () => {
  // Fixture NOVA a cada teste: compartilhar o objeto deixaria os testes
  // seguintes sem nada a detectar depois que o primeiro já tivesse mutado.
  const loteNovo = () => [
    {
      Descricao_Original: 'AMZ *B0CX',
      Nome_Fantasia: 'AMZ *B0CX',
      Categoria: '-',
      Valor: -100,
      Parcela_Atual: 2,
      Total_Parcelas: 6,
      Data: new Date(2026, 1, 15),
      ID_Conta: CONTA,
      Origem: 'fatura-fev.csv',
      referenceMonth: '2026-01',
    },
  ];

  // A irmã difere em 1 centavo DE PROPÓSITO: se algum dia a aplicação copiar
  // `Valor` (ou qualquer outro campo da irmã) junto com descrição/categoria,
  // os testes abaixo enxergam. Com valores idênticos, não enxergariam.
  const preparar = () => {
    const lote = loteNovo();
    const sugestoes = construirSugestoesDeParcela(
      lote,
      CONTA,
      [existente({
        Nome_Fantasia: 'Amazon — Fone', Categoria: 'Eletrônicos',
        Valor: -100.01, Data: new Date(2026, 0, 15),
      })]
    );
    return { lote, sugestoes, idIrma: sugestoes[0].candidatos[0].idTransacao };
  };

  it('descrição e categoria passam a ser as da irmã', () => {
    const { lote, sugestoes, idIrma } = preparar();
    const [aplicada] = aplicarEscolhasDeParcela(lote, sugestoes, new Map([[0, idIrma]]));

    expect(aplicada.Nome_Fantasia).toBe('Amazon — Fone');
    expect(aplicada.Categoria).toBe('Eletrônicos');
  });

  it('valor, data, parcela, competência, conta e origem NÃO mudam', () => {
    const { lote, sugestoes, idIrma } = preparar();
    const original = loteNovo()[0];
    const [aplicada] = aplicarEscolhasDeParcela(lote, sugestoes, new Map([[0, idIrma]]));

    for (const campo of ['Valor', 'Data', 'Parcela_Atual', 'Total_Parcelas', 'referenceMonth', 'ID_Conta', 'Origem'] as const) {
      expect(aplicada[campo]).toEqual(original[campo]);
    }
  });

  it('escolher "nenhuma" deixa a transação exatamente como veio do arquivo', () => {
    const { lote, sugestoes } = preparar();
    const [aplicada] = aplicarEscolhasDeParcela(lote, sugestoes, new Map([[0, null]]));
    expect(aplicada).toEqual(loteNovo()[0]);
  });

  it('escolha para um id que não é candidato é ignorada — nunca inventa valor', () => {
    const { lote, sugestoes } = preparar();
    const [aplicada] = aplicarEscolhasDeParcela(lote, sugestoes, new Map([[0, 'id-inexistente']]));
    expect(aplicada).toEqual(loteNovo()[0]);
  });

  it('só a parcela escolhida muda; as demais do lote seguem intactas', () => {
    const { lote, sugestoes, idIrma } = preparar();
    const irrelevante = { ...loteNovo()[0], Nome_Fantasia: 'Outra', Valor: -9, Parcela_Atual: 1 };
    lote.push(irrelevante);
    const resultado = aplicarEscolhasDeParcela(lote, sugestoes, new Map([[0, idIrma]]));

    expect(resultado[0].Nome_Fantasia).toBe('Amazon — Fone');
    expect(resultado[1]).toEqual(irrelevante);
  });

  it('não muta a lista de entrada', () => {
    const { lote, sugestoes, idIrma } = preparar();
    const antes = JSON.stringify(lote);

    aplicarEscolhasDeParcela(lote, sugestoes, new Map([[0, idIrma]]));

    expect(JSON.stringify(lote)).toBe(antes);
  });
});

describe('10/12. a consulta não toca em dado nenhum', () => {
  it('não altera as transações existentes nem as importadas', () => {
    const existentes = [existente({ Nome_Fantasia: 'Original', Categoria: 'Compras', Valor: -100 })];
    const antesExistentes = JSON.stringify(existentes);
    const novas = [importada()];
    const antesNovas = JSON.stringify(novas);

    construirSugestoesDeParcela(novas, CONTA, existentes);

    expect(JSON.stringify(existentes)).toBe(antesExistentes);
    expect(JSON.stringify(novas)).toBe(antesNovas);
  });

  it('o candidato carrega apenas descrição e categoria como sugestão — nada financeiro', () => {
    const [sugestao] = construirSugestoesDeParcela([importada()], CONTA, [existente({})]);
    const candidato = sugestao.candidatos[0];

    // Valor/parcela/data existem só para o usuário reconhecer a compra na
    // tela de escolha — não são o que a sugestão copia.
    expect(Object.keys(candidato).sort()).toEqual(
      ['categoria', 'confianca', 'data', 'idTransacao', 'nomeFantasia', 'parcelaAtual', 'totalParcelas', 'valor'].sort()
    );
  });
});
