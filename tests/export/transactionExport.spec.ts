import { describe, expect, it } from 'vitest';
import {
  ORIGEM_IMPORTADO,
  ORIGEM_MANUAL,
  ORIGEM_OPEN_FINANCE,
  buildTransactionExportRows,
  describeExportOrigin,
  exportValueToCents,
  getTransactionExportColumns,
  stripInternalMarkers,
  toExportDate,
  type TransactionExportRow,
} from '../../src/domain/export/transactionExport';
import { ACCOUNTS, SYNTHETIC_TOTAL_CENTS, makeTx, syntheticSet } from './fixtures';

const build = (transactions = [makeTx()], getOwnerLabel?: (t: unknown) => string | undefined) =>
  buildTransactionExportRows(transactions, { accounts: ACCOUNTS, getOwnerLabel });

const one = (overrides: Parameters<typeof makeTx>[0]): TransactionExportRow =>
  build([makeTx(overrides)])[0];

describe('colunas do arquivo', () => {
  it('seguem a ordem de leitura e usam cabeçalhos voltados ao usuário', () => {
    expect(getTransactionExportColumns(false).map((c) => c.header)).toEqual([
      'Data',
      'Data de pagamento',
      'Descrição',
      'Descrição original',
      'Valor',
      'Tipo',
      'Categoria',
      'Conta',
      'Cartão',
      'Portador',
      'Origem',
      'Parcela',
    ]);
  });

  it('Responsável só entra quando pedido, e por último', () => {
    const com = getTransactionExportColumns(true).map((c) => c.header);
    expect(com[com.length - 1]).toBe('Responsável');
    expect(getTransactionExportColumns(false).map((c) => c.header)).not.toContain('Responsável');
  });

  it('não expõe Tags, Observações nem identificadores técnicos', () => {
    const headers = getTransactionExportColumns(true).map((c) => c.header.toLowerCase());
    const keys = getTransactionExportColumns(true).map((c) => c.key.toLowerCase());
    for (const proibido of ['tags', 'observações', 'observacoes', 'user_id', 'id', 'created_at', 'updated_at']) {
      expect(headers).not.toContain(proibido);
      expect(keys).not.toContain(proibido);
    }
    // nenhum cabeçalho é o nome técnico do campo
    for (const tecnico of ['Data_Pagamento', 'Total_Parcelas', 'Parcela_Atual', 'Nome_Fantasia']) {
      expect(headers).not.toContain(tecnico.toLowerCase());
    }
  });

  it('cada coluna declara como o valor deve ser gravado', () => {
    const kinds = Object.fromEntries(getTransactionExportColumns(false).map((c) => [c.key, c.kind]));
    expect(kinds.data).toBe('date');
    expect(kinds.dataPagamento).toBe('date');
    expect(kinds.valor).toBe('currency');
    expect(kinds.descricao).toBe('text');
  });
});

describe('transação normal e campos básicos', () => {
  it('mapeia uma transação comum sem perder nada', () => {
    const row = one({
      Nome_Fantasia: 'Padaria São João',
      Descricao_Original: 'PADARIA SAO JOAO LTDA',
      Valor: -23.5,
      Categoria: 'Mercado',
      Tipo: 'Despesa',
    });
    expect(row.descricao).toBe('Padaria São João');
    expect(row.descricaoOriginal).toBe('PADARIA SAO JOAO LTDA');
    expect(row.valor).toBe(-23.5);
    expect(row.categoria).toBe('Mercado');
    expect(row.tipo).toBe('Despesa');
    expect(row.conta).toBe('Conta Corrente Exemplo');
  });

  it('preserva acentos, vírgula, aspas e ponto e vírgula no texto', () => {
    const row = one({ Nome_Fantasia: 'Café; bolo e "pão", ação', Descricao_Original: 'AÇÃO, "PÃO"' });
    expect(row.descricao).toBe('Café; bolo e "pão", ação');
    expect(row.descricaoOriginal).toBe('AÇÃO, "PÃO"');
  });

  it('valor positivo, negativo e zero saem como número', () => {
    expect(one({ Valor: 5432.1 }).valor).toBe(5432.1);
    expect(one({ Valor: -412.37 }).valor).toBe(-412.37);
    expect(one({ Valor: 0 }).valor).toBe(0);
  });

  it('valor que não é número finito vira null — nunca 0', () => {
    expect(one({ Valor: Number.NaN }).valor).toBeNull();
    expect(one({ Valor: undefined as unknown as number }).valor).toBeNull();
    expect(one({ Valor: '' as unknown as number }).valor).toBeNull();
    expect(one({ Valor: Number.POSITIVE_INFINITY }).valor).toBeNull();
  });

  it('valor numérico em texto é lido como número', () => {
    expect(one({ Valor: '-12.5' as unknown as number }).valor).toBe(-12.5);
  });
});

describe('datas', () => {
  it('Data e Data de pagamento são Date de verdade, no dia civil certo', () => {
    const row = one({
      Data: new Date('2026-08-15T00:00:00Z'),
      Data_Pagamento: new Date('2026-09-10T00:00:00Z'),
    });
    expect(row.data).toBeInstanceOf(Date);
    expect(row.dataPagamento).toBeInstanceOf(Date);
    expect(row.data?.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(row.dataPagamento?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('a data de pagamento diferente da compra não é confundida com ela', () => {
    const row = one({
      Data: new Date('2026-08-15T00:00:00Z'),
      Data_Pagamento: new Date('2026-09-10T00:00:00Z'),
    });
    expect(row.data?.getTime()).not.toBe(row.dataPagamento?.getTime());
  });

  it('sem data de pagamento fica null, não uma cópia da data da compra', () => {
    const row = one({ Data: new Date('2026-08-15T00:00:00Z'), Data_Pagamento: undefined });
    expect(row.dataPagamento).toBeNull();
    expect(row.data).not.toBeNull();
  });

  it('data vinda como texto ISO mantém o mesmo dia (sem virada por fuso)', () => {
    expect(toExportDate('2026-01-01')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(toExportDate('2026-12-31')?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(toExportDate('2026-09-02T23:59:59-03:00')?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('data inválida ou ausente vira null', () => {
    expect(toExportDate('não é data')).toBeNull();
    expect(toExportDate('2026-02-31')).toBeNull();
    expect(toExportDate(undefined)).toBeNull();
    expect(toExportDate(null)).toBeNull();
    expect(toExportDate(new Date('invalid'))).toBeNull();
  });
});

describe('Portador, Conta e Cartão', () => {
  it('exporta o portador, sem espaços sobrando', () => {
    expect(one({ Portador: '  TITULAR EXEMPLO ' }).portador).toBe('TITULAR EXEMPLO');
  });

  it('sem portador fica vazio', () => {
    expect(one({ Portador: undefined }).portador).toBe('');
    expect(one({ Portador: '' }).portador).toBe('');
  });

  it('Cartão só é preenchido para conta de Cartão de Crédito', () => {
    expect(one({ ID_Conta: 'acc-card' }).cartao).toBe('Cartão Exemplo');
    expect(one({ ID_Conta: 'acc-card' }).conta).toBe('Cartão Exemplo');
    expect(one({ ID_Conta: 'acc-cc' }).cartao).toBe('');
  });

  it('cartão de benefício (Cartão Alimentação) não é tratado como cartão de crédito', () => {
    const row = one({ ID_Conta: 'acc-vale' });
    expect(row.conta).toBe('Vale Refeição Exemplo');
    expect(row.cartao).toBe('');
  });

  it('sem conta e conta desconhecida mantêm os rótulos que o arquivo já tinha', () => {
    expect(one({ ID_Conta: undefined }).conta).toBe('Sem conta');
    expect(one({ ID_Conta: 'acc-inexistente' }).conta).toBe('Conta desconhecida');
    expect(one({ ID_Conta: 'acc-inexistente' }).cartao).toBe('');
  });

  it('Responsável só existe quando há rótulo do dono', () => {
    const semFamilia = build([makeTx()]);
    expect('responsavel' in semFamilia[0]).toBe(false);

    const comFamilia = build([makeTx()], () => 'Maria');
    expect(comFamilia[0].responsavel).toBe('Maria');

    const semRotulo = build([makeTx()], () => undefined);
    expect(semRotulo[0].responsavel).toBe('');
  });
});

describe('Origem — nunca o nome do arquivo', () => {
  it('manual', () => {
    expect(describeExportOrigin('manual')).toBe(ORIGEM_MANUAL);
    expect(describeExportOrigin('Manual')).toBe(ORIGEM_MANUAL);
    expect(describeExportOrigin('  MANUAL ')).toBe(ORIGEM_MANUAL);
    expect(one({ Origem: 'manual' }).origem).toBe('Manual');
  });

  it('Open Finance', () => {
    expect(describeExportOrigin('Open Finance')).toBe(ORIGEM_OPEN_FINANCE);
    expect(describeExportOrigin('open finance')).toBe(ORIGEM_OPEN_FINANCE);
  });

  it('arquivo importado vira apenas "Importado"', () => {
    for (const origem of [
      'Fatura_Cartao_Fulano_Jan_2026.csv',
      'Extrato Maria da Silva.ofx',
      'PosicaoDetalhada_XP_Ione_Jan_2026.xlsx',
      'demo.csv',
    ]) {
      expect(describeExportOrigin(origem)).toBe(ORIGEM_IMPORTADO);
    }
  });

  it('nome de banco usado como fallback do parser também é importação', () => {
    expect(describeExportOrigin('Nubank')).toBe(ORIGEM_IMPORTADO);
  });

  it('origem vazia ou ausente fica vazia — não é inventada', () => {
    expect(describeExportOrigin('')).toBe('');
    expect(describeExportOrigin('   ')).toBe('');
    expect(describeExportOrigin(null)).toBe('');
    expect(describeExportOrigin(undefined)).toBe('');
  });

  it('nenhum trecho do nome do arquivo chega à linha exportada', () => {
    const row = one({ Origem: 'Fatura_Cartao_Fulano_Set_2026.csv' });
    expect(JSON.stringify(row)).not.toMatch(/fulano|fatura_cartao|\.csv/i);
    expect(row.origem).toBe('Importado');
  });

  it('só existem as classes que os dados sustentam', () => {
    const classes = new Set(
      ['manual', 'Open Finance', 'arquivo.csv', 'Banco X'].map((o) => describeExportOrigin(o))
    );
    expect([...classes].sort()).toEqual(['Importado', 'Manual', 'Open Finance']);
    expect(classes.has('Sistema')).toBe(false);
  });
});

describe('marcadores internos FinElo', () => {
  it('descrição normal fica exatamente como estava', () => {
    expect(stripInternalMarkers('PADARIA SAO JOAO LTDA')).toBe('PADARIA SAO JOAO LTDA');
    expect(stripInternalMarkers('')).toBe('');
    expect(stripInternalMarkers(null)).toBe('');
    expect(stripInternalMarkers(undefined)).toBe('');
  });

  it('remove finelo_competence e preserva o texto real', () => {
    expect(stripInternalMarkers('Pagamento de Fatura (2026-08) finelo_competence:2026-08')).toBe(
      'Pagamento de Fatura (2026-08)'
    );
  });

  it('marcador sozinho vira vazio', () => {
    expect(stripInternalMarkers('finelo_competence:2026-08')).toBe('');
  });

  it('marcador no começo ou no meio do texto', () => {
    expect(stripInternalMarkers('finelo_competence:2026-08 Pagamento de fatura')).toBe(
      'Pagamento de fatura'
    );
    expect(stripInternalMarkers('Pagamento finelo_competence:2026-08 do cartão')).toBe(
      'Pagamento do cartão'
    );
  });

  it('remove finelo_funding_account sem deixar o UUID interno', () => {
    const uuid = '3d3893bb-dc6b-4bec-80ad-c9de840aacfc';
    const limpo = stripInternalMarkers(`Pagamento de Fatura (2026-08) finelo_funding_account:${uuid}`);
    expect(limpo).toBe('Pagamento de Fatura (2026-08)');
    expect(limpo).not.toContain(uuid);
  });

  it('vários marcadores no mesmo texto', () => {
    const uuid = '3d3893bb-dc6b-4bec-80ad-c9de840aacfc';
    const limpo = stripInternalMarkers(
      `Pagamento de Fatura (2026-08) finelo_competence:2026-08 finelo_funding_account:${uuid}`
    );
    expect(limpo).toBe('Pagamento de Fatura (2026-08)');
    expect(limpo.toLowerCase()).not.toContain('finelo_');
  });

  it('cobre marcadores futuros da mesma família e maiúsculas/minúsculas', () => {
    expect(stripInternalMarkers('Texto finelo_novo_campo:abc123')).toBe('Texto');
    expect(stripInternalMarkers('Texto FINELO_COMPETENCE:2026-08')).toBe('Texto');
  });

  it('não altera texto que só contém "finelo_" sem ser marcador', () => {
    expect(stripInternalMarkers('  usuario finelo_teste  ')).toBe('  usuario finelo_teste  ');
  });

  it('não mexe em espaços duplos do texto real quando não há marcador', () => {
    expect(stripInternalMarkers('LOJA   CENTRO  SP')).toBe('LOJA   CENTRO  SP');
  });

  it('a linha exportada nunca carrega marcador nas duas descrições', () => {
    const row = one({
      Nome_Fantasia: 'Pagamento finelo_competence:2026-07',
      Descricao_Original: 'Pagamento de Fatura (2026-07) finelo_competence:2026-07',
    });
    expect(row.descricao).toBe('Pagamento');
    expect(row.descricaoOriginal).toBe('Pagamento de Fatura (2026-07)');
  });

  it('nenhuma célula de texto do conjunto sintético contém finelo_', () => {
    const rows = build(syntheticSet());
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (typeof value === 'string') expect(value.toLowerCase()).not.toContain('finelo_');
      }
    }
  });
});

describe('parcelamento — mesma semântica do 9C10', () => {
  const parcela = (atual: number | undefined | null, total: number | undefined | null) =>
    one({
      Parcela_Atual: atual as number | undefined,
      Total_Parcelas: total as number | undefined,
    }).parcela;

  it('parcela válida', () => {
    expect(parcela(3, 10)).toBe('3/10');
    expect(parcela(1, 4)).toBe('1/4');
  });

  it('sem parcelamento: vazio, nunca "1/1"', () => {
    expect(parcela(undefined, undefined)).toBe('');
    expect(parcela(null, null)).toBe('');
    expect(parcela(undefined, undefined)).not.toBe('1/1');
  });

  it('legado 0/0: vazio', () => {
    expect(parcela(0, 0)).toBe('');
  });

  it('1/1 realmente persistido continua aparecendo', () => {
    expect(parcela(1, 1)).toBe('1/1');
  });

  it('par incompleto não vira parcela válida: "3/?" e "?/10"', () => {
    expect(parcela(3, undefined)).toBe('3/?');
    expect(parcela(undefined, 10)).toBe('?/10');
  });

  it('nunca reproduz o fallback antigo "n/1"', () => {
    expect(parcela(3, undefined)).not.toBe('3/1');
    expect(parcela(3, null)).not.toBe('3/1');
    expect(parcela(3, 0)).not.toBe('3/1');
  });

  it('par incoerente é exibido como está, não corrigido', () => {
    expect(parcela(5, 3)).toBe('5/3');
  });
});

describe('conservação — sem perda e sem duplicação', () => {
  it('uma linha por transação, na mesma ordem', () => {
    const set = syntheticSet();
    const rows = build(set);
    expect(rows).toHaveLength(set.length);
    // Nenhum Nome_Fantasia do conjunto tem marcador: a descrição exportada tem que ser a de origem.
    expect(rows.map((r) => r.descricao)).toEqual(set.map((t) => t.Nome_Fantasia));
  });

  it('a soma dos valores exportados, em centavos, é o total conhecido', () => {
    const set = syntheticSet();
    const rows = build(set);
    const exportado = rows.reduce((acc, r) => acc + exportValueToCents(r.valor), 0);
    const fonte = set.reduce((acc, t) => acc + Math.round(t.Valor * 100), 0);
    expect(fonte).toBe(SYNTHETIC_TOTAL_CENTS);
    expect(exportado).toBe(SYNTHETIC_TOTAL_CENTS);
    expect(exportado).toBe(fonte);
  });

  it('conjunto vazio gera zero linhas', () => {
    expect(build([])).toEqual([]);
  });

  it('não altera as transações de origem', () => {
    const set = syntheticSet();
    const antes = JSON.stringify(set);
    build(set);
    expect(JSON.stringify(set)).toBe(antes);
  });
});

describe('campos opcionais ausentes', () => {
  it('uma transação só com o obrigatório vira uma linha válida, com vazios apropriados', () => {
    const minima = makeTx({
      Data_Pagamento: undefined,
      Portador: undefined,
      Parcela_Atual: undefined,
      Total_Parcelas: undefined,
      Origem: '',
      Categoria: '',
      ID_Conta: undefined,
    });
    const row = build([minima])[0];
    expect(row.dataPagamento).toBeNull();
    expect(row.portador).toBe('');
    expect(row.parcela).toBe('');
    expect(row.origem).toBe('');
    expect(row.categoria).toBe('');
    expect(row.cartao).toBe('');
    expect(row.conta).toBe('Sem conta');
  });
});
