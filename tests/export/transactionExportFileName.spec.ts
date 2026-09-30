import { describe, expect, it } from 'vitest';
import { buildTransactionExportFileName } from '../../src/domain/export/transactionExportFileName';

type Filtros = Parameters<typeof buildTransactionExportFileName>[0];

/** Filtros de período, sempre explícitos: nada aqui depende do dia em que o teste roda. */
const periodo = (startDate: string, endDate: string, over: Partial<Filtros> = {}): Filtros => ({
  startDate,
  endDate,
  periodPreset: 'custom',
  viewScope: 'operation',
  ...over,
});

const nome = (filtros: Filtros, ext: 'csv' | 'xlsx' = 'csv') =>
  buildTransactionExportFileName(filtros, ext);

describe('nome do arquivo de exportação', () => {
  it('mês inteiro vira AAAA-MM', () => {
    expect(nome(periodo('2026-09-01', '2026-09-30'))).toBe('finelo-transacoes-2026-09.csv');
  });

  it('mês inteiro respeita o último dia de cada mês (30, 31, fevereiro comum e bissexto)', () => {
    expect(nome(periodo('2026-04-01', '2026-04-30'))).toBe('finelo-transacoes-2026-04.csv');
    expect(nome(periodo('2026-01-01', '2026-01-31'))).toBe('finelo-transacoes-2026-01.csv');
    expect(nome(periodo('2026-02-01', '2026-02-28'))).toBe('finelo-transacoes-2026-02.csv');
    expect(nome(periodo('2028-02-01', '2028-02-29'))).toBe('finelo-transacoes-2028-02.csv');
  });

  it('um mês incompleto NÃO finge ser o mês inteiro', () => {
    expect(nome(periodo('2026-09-01', '2026-09-15'))).toBe(
      'finelo-transacoes-2026-09-01_a_2026-09-15.csv'
    );
    expect(nome(periodo('2026-09-02', '2026-09-30'))).toBe(
      'finelo-transacoes-2026-09-02_a_2026-09-30.csv'
    );
    // 29/02 não existe em 2026: fim em 28 é o mês inteiro, fim em 27 não é
    expect(nome(periodo('2026-02-01', '2026-02-27'))).toBe(
      'finelo-transacoes-2026-02-01_a_2026-02-27.csv'
    );
  });

  it('intervalo livre entre meses mostra as duas datas', () => {
    expect(nome(periodo('2026-08-15', '2026-09-10'))).toBe(
      'finelo-transacoes-2026-08-15_a_2026-09-10.csv'
    );
    expect(nome(periodo('2026-08-01', '2026-09-30'))).toBe(
      'finelo-transacoes-2026-08-01_a_2026-09-30.csv'
    );
  });

  it('um único dia', () => {
    expect(nome(periodo('2026-09-10', '2026-09-10'))).toBe('finelo-transacoes-2026-09-10.csv');
  });

  it('só início ou só fim', () => {
    expect(nome(periodo('2026-08-15', ''))).toBe('finelo-transacoes-a-partir-de-2026-08-15.csv');
    expect(nome(periodo('', '2026-09-10'))).toBe('finelo-transacoes-ate-2026-09-10.csv');
  });
});

describe('todo o histórico', () => {
  it('nunca finge ser um único mês', () => {
    const arquivo = nome(periodo('', '', { periodPreset: 'all' }));
    expect(arquivo).toBe('finelo-transacoes-todo-o-historico.csv');
    expect(arquivo).not.toMatch(/\d{4}-\d{2}/);
  });

  it('o escopo "tudo" vence datas que sobraram no filtro', () => {
    expect(nome(periodo('2026-09-01', '2026-09-30', { viewScope: 'all' }))).toBe(
      'finelo-transacoes-todo-o-historico.csv'
    );
    expect(nome(periodo('2026-09-01', '2026-09-30', { periodPreset: 'all' }))).toBe(
      'finelo-transacoes-todo-o-historico.csv'
    );
  });

  it('sem nenhuma data também é o histórico inteiro', () => {
    expect(nome(periodo('', ''))).toBe('finelo-transacoes-todo-o-historico.csv');
  });

  it('datas inválidas não viram parte do nome', () => {
    expect(nome(periodo('lixo', 'também lixo'))).toBe('finelo-transacoes-todo-o-historico.csv');
    expect(nome(periodo('2026-02-31', ''))).toBe('finelo-transacoes-todo-o-historico.csv');
  });
});

describe('extensão', () => {
  it('CSV e XLSX diferem só na extensão', () => {
    const filtros = periodo('2026-09-01', '2026-09-30');
    expect(nome(filtros, 'csv')).toBe('finelo-transacoes-2026-09.csv');
    expect(nome(filtros, 'xlsx')).toBe('finelo-transacoes-2026-09.xlsx');
    expect(nome(filtros, 'csv').replace(/\.csv$/, '')).toBe(nome(filtros, 'xlsx').replace(/\.xlsx$/, ''));
  });
});

describe('segurança do nome', () => {
  const casos: Array<[string, Filtros]> = [
    ['mês', periodo('2026-09-01', '2026-09-30')],
    ['intervalo', periodo('2026-08-15', '2026-09-10')],
    ['dia', periodo('2026-09-10', '2026-09-10')],
    ['só início', periodo('2026-08-15', '')],
    ['histórico', periodo('', '', { periodPreset: 'all' })],
    ['entrada hostil', periodo('../../etc/passwd', '<script>alert(1)</script>')],
  ];

  it.each(casos)('só tem caracteres seguros em qualquer sistema de arquivos (%s)', (_, filtros) => {
    for (const ext of ['csv', 'xlsx'] as const) {
      expect(nome(filtros, ext)).toMatch(/^[a-z0-9._-]+$/);
    }
  });

  it('nunca contém separador de caminho, espaço, acento nem nome de pessoa', () => {
    for (const [, filtros] of casos) {
      const arquivo = nome(filtros);
      expect(arquivo).not.toMatch(/[\\/\s:*?"<>|]/);
      expect(arquivo).not.toMatch(/[^\x20-\x7e]/);
    }
  });

  it('o nome é só a marca do produto mais o período — nada digitado pelo usuário', () => {
    const filtrosComTexto = {
      ...periodo('2026-09-01', '2026-09-30'),
      text: 'Maria da Silva',
      accountId: ['conta-de-joao'],
      ownerUserId: 'uuid-do-dono',
    } as unknown as Filtros;
    const arquivo = nome(filtrosComTexto);
    expect(arquivo).toBe('finelo-transacoes-2026-09.csv');
    expect(arquivo).not.toMatch(/maria|silva|joao|uuid/i);
  });
});
