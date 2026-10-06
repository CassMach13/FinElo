import { describe, expect, it } from 'vitest';
import {
  buildRecurrenceFilterPatch,
  detectRecurrences,
  getRecurrenceWindow,
  normalizeRecurrenceName,
} from '../../src/domain/recurrences/detectRecurrences';
import type { Category, Transaction } from '../../src/types';

const TODAY = '2026-10-06';

const categories: Category[] = [
  { id: '1', Nome_Categoria: 'Lazer', Tipo: 'Despesa' },
  { id: '2', Nome_Categoria: 'Salário', Tipo: 'Renda' },
  { id: '3', Nome_Categoria: 'Movimentação', Tipo: 'Ambos' },
  { id: '4', Nome_Categoria: 'Aportes', Tipo: 'Despesa', is_investment: true },
];

let seq = 0;
const tx = (date: string, name: string, valor: number, extra: Partial<Transaction> = {}): Transaction =>
  ({
    ID_Transacao: `t${String((seq += 1)).padStart(4, '0')}`,
    user_id: 'u1',
    Data: date,
    Descricao_Original: name,
    Nome_Fantasia: name,
    Valor: -Math.abs(valor),
    Tipo: 'Despesa',
    Categoria: 'Lazer',
    Origem: 'manual',
    Fonte: 'Manual',
    ID_Conta: 'acc1',
    ...extra,
  }) as unknown as Transaction;

/** Uma cobrança por mês, no dia `day`, para cada mês `AAAA-MM` informado. */
const monthly = (name: string, months: string[], valor = 39.9, day = 10, extra: Partial<Transaction> = {}) =>
  months.map((m) => tx(`${m}-${String(day).padStart(2, '0')}`, name, valor, extra));

const detect = (transactions: Transaction[], today: string = TODAY) =>
  detectRecurrences({ transactions, categories, today });

const SEP_AUG_JUL = ['2026-07', '2026-08', '2026-09'];

describe('Janela de 12 meses completos', () => {
  it('em outubro/2026: 01/10/2025 a 30/09/2026', () => {
    const w = getRecurrenceWindow('2026-10-06');
    expect(w.startDate).toBe('2025-10-01');
    expect(w.endDate).toBe('2026-09-30');
    expect(w.months).toHaveLength(12);
    expect(w.months[0]).toBe('2025-10');
    expect(w.months[11]).toBe('2026-09');
  });

  it('janeiro: 01/01 a 31/12 do ano anterior (virada de ano)', () => {
    const w = getRecurrenceWindow('2027-01-15');
    expect([w.startDate, w.endDate]).toEqual(['2026-01-01', '2026-12-31']);
  });

  it('fevereiro e ano bissexto: o fim da janela respeita o último dia do mês', () => {
    expect(getRecurrenceWindow('2028-03-01').endDate).toBe('2028-02-29');
    expect(getRecurrenceWindow('2027-03-01').endDate).toBe('2027-02-28');
    expect(getRecurrenceWindow('2028-03-01').startDate).toBe('2027-03-01');
  });

  it('o mês atual nunca faz parte da janela, qualquer que seja o dia', () => {
    for (const day of ['2026-10-01', '2026-10-31']) {
      expect(getRecurrenceWindow(day).months).not.toContain('2026-10');
    }
  });
});

describe('Detecção — meses e recência', () => {
  it('A. 3 meses exatos → candidato', () => {
    const r = detect(monthly('Streaming', SEP_AUG_JUL));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ monthCount: 3, occurrenceCount: 3, displayName: 'Streaming' });
  });

  it('B. 2 meses → não candidato', () => {
    expect(detect(monthly('Streaming', ['2026-08', '2026-09']))).toEqual([]);
  });

  it('C. 3 meses não consecutivos → candidato', () => {
    expect(detect(monthly('Streaming', ['2026-01', '2026-03', '2026-09']))).toHaveLength(1);
  });

  it('D. o mês atual é ignorado na detecção histórica', () => {
    const data = [...monthly('Streaming', ['2026-08', '2026-09']), tx('2026-10-02', 'Streaming', 39.9)];
    expect(detect(data)).toEqual([]); // com o mês atual seriam 3
  });

  it('E. última ocorrência fora dos 2 últimos meses → inativa, não aparece', () => {
    expect(detect(monthly('Streaming', ['2026-04', '2026-05', '2026-06']))).toEqual([]);
    expect(detect(monthly('Streaming', ['2026-05', '2026-06', '2026-07']))).toEqual([]);
  });

  it('F. última ocorrência em agosto ou setembro (hoje em outubro) → ativa', () => {
    expect(detect(monthly('A', ['2026-05', '2026-06', '2026-08']))).toHaveLength(1);
    expect(detect(monthly('B', ['2026-05', '2026-06', '2026-09']))).toHaveLength(1);
  });

  it('I. 4+ meses → candidato com monthCount correto', () => {
    const r = detect(monthly('Streaming', ['2026-03', '2026-04', '2026-06', '2026-07', '2026-09']));
    expect(r[0].monthCount).toBe(5);
  });

  it('ocorrência anterior à janela não conta', () => {
    expect(detect(monthly('Streaming', ['2025-08', '2025-09', '2026-09']))).toEqual([]);
  });

  it('J. virada de ano: dez, jan, fev com hoje em março', () => {
    const r = detect(monthly('Plano', ['2025-12', '2026-01', '2026-02']), '2026-03-10');
    expect(r).toHaveLength(1);
    expect(r[0].firstOccurrenceDate).toBe('2025-12-10');
    expect(r[0].lastOccurrenceDate).toBe('2026-02-10');
  });

  it('K/L. fevereiro e bissexto: 29/02 fica em fevereiro', () => {
    const data = [tx('2028-01-31', 'Plano', 10), tx('2028-02-29', 'Plano', 10), tx('2027-12-31', 'Plano', 10)];
    const r = detect(data, '2028-03-05');
    expect(r).toHaveLength(1);
    expect(r[0].lastOccurrenceDate).toBe('2028-02-29');
    // 01/03 já é o mês atual: não conta
    expect(detect([...data.slice(0, 1), tx('2027-12-31', 'Plano', 10), tx('2028-03-01', 'Plano', 10)], '2028-03-05')).toEqual([]);
  });

  it('strings ISO com horário e meia-noite UTC não deslocam o mês', () => {
    const data = [
      tx('2026-07-01T00:00:00+00:00', 'Plano', 10),
      tx(new Date('2026-08-01T00:00:00.000Z') as unknown as string, 'Plano', 10),
      tx('2026-09-30T23:30:00', 'Plano', 10),
    ];
    const r = detect(data);
    expect(r).toHaveLength(1);
    expect(r[0].firstOccurrenceDate).toBe('2026-07-01');
    expect(r[0].lastOccurrenceDate).toBe('2026-09-30');
  });

  it('data inválida não cria candidato nem estoura', () => {
    expect(detect([tx('lixo', 'Plano', 10), tx('', 'Plano', 10), ...monthly('Plano', ['2026-08', '2026-09'])])).toEqual([]);
  });
});

describe('Regra de 1 ocorrência por mês', () => {
  it('G. 2 lançamentos no mesmo mês → o grupo inteiro é excluído', () => {
    const data = [...monthly('Mercado', ['2026-07', '2026-08', '2026-09']), tx('2026-09-20', 'Mercado', 30)];
    expect(detect(data)).toEqual([]);
  });

  it('H. duplicidade em apenas UM dos meses (jan 1, fev 1, mar 2) → excluído', () => {
    const data = [
      tx('2026-05-05', 'Mercado', 50),
      tx('2026-06-05', 'Mercado', 50),
      tx('2026-07-05', 'Mercado', 50),
      tx('2026-07-25', 'Mercado', 50),
      tx('2026-08-05', 'Mercado', 50),
      tx('2026-09-05', 'Mercado', 50),
    ];
    expect(detect(data)).toEqual([]);
  });

  it('duplicidade fora da janela ou no mês atual não desqualifica', () => {
    const data = [
      ...monthly('Plano', SEP_AUG_JUL),
      tx('2026-10-01', 'Plano', 10),
      tx('2026-10-02', 'Plano', 10),
      tx('2024-01-01', 'Plano', 10),
      tx('2024-01-02', 'Plano', 10),
    ];
    expect(detect(data)).toHaveLength(1);
  });
});

describe('Normalização e identidade', () => {
  it('caixa, acento e espaços convergem', () => {
    expect(normalizeRecurrenceName('  Nétflix   BR ')).toBe('netflix br');
    const data = [
      tx('2026-07-10', 'NETFLIX', 39.9),
      tx('2026-08-10', 'Netflix', 39.9),
      tx('2026-09-10', '  Nétflix  ', 39.9),
    ];
    const r = detect(data);
    expect(r).toHaveLength(1);
    expect(r[0].normalizedName).toBe('netflix');
  });

  it('fallback: Nome_Fantasia vazio usa Descricao_Original', () => {
    const data = monthly('x', SEP_AUG_JUL).map((t) => ({ ...t, Nome_Fantasia: '   ', Descricao_Original: 'Academia Z' }) as Transaction);
    const r = detect(data);
    expect(r[0].displayName).toBe('Academia Z');
  });

  it('Nome_Fantasia é preferido à descrição bruta', () => {
    const data = monthly('x', SEP_AUG_JUL).map((t) => ({ ...t, Nome_Fantasia: 'Academia', Descricao_Original: 'PGTO*ACAD 0912' }) as Transaction);
    expect(detect(data)[0].displayName).toBe('Academia');
  });

  it('ambos vazios → excluído', () => {
    const data = monthly('x', SEP_AUG_JUL).map((t) => ({ ...t, Nome_Fantasia: '', Descricao_Original: '  ' }) as Transaction);
    expect(detect(data)).toEqual([]);
  });

  it('dígitos NÃO são removidos: "SERVICO 123" e "SERVICO 456" não convergem', () => {
    const data = [
      tx('2026-07-10', 'SERVICO 123', 10),
      tx('2026-08-10', 'SERVICO 456', 10),
      tx('2026-09-10', 'SERVICO 789', 10),
    ];
    expect(detect(data)).toEqual([]);
    expect(normalizeRecurrenceName('SERVICO 123')).not.toBe(normalizeRecurrenceName('SERVICO 456'));
  });

  it('sem fuzzy: nomes parecidos não se juntam', () => {
    const data = [tx('2026-07-10', 'Netflix', 10), tx('2026-08-10', 'Netflix.com', 10), tx('2026-09-10', 'Netflx', 10)];
    expect(detect(data)).toEqual([]);
  });
});

describe('Dono e conta', () => {
  it('mesmo nome para donos diferentes → grupos separados (e cada um precisa dos seus 3 meses)', () => {
    const a = monthly('Plano Família', SEP_AUG_JUL, 50, 10, { user_id: 'user-a' });
    const b = monthly('Plano Família', SEP_AUG_JUL, 50, 10, { user_id: 'user-b' });
    const r = detect([...a, ...b]);
    expect(r.map((c) => c.ownerUserId).sort()).toEqual(['user-a', 'user-b']);
    expect(r.every((c) => c.monthCount === 3)).toBe(true);
  });

  it('meses de donos diferentes não se somam numa sequência', () => {
    const data = [
      tx('2026-07-10', 'Plano', 10, { user_id: 'user-a' }),
      tx('2026-08-10', 'Plano', 10, { user_id: 'user-b' }),
      tx('2026-09-10', 'Plano', 10, { user_id: 'user-a' }),
    ];
    expect(detect(data)).toEqual([]);
  });

  it('dois donos no mesmo mês não violam a regra de 1 por mês (são chaves diferentes)', () => {
    const data = [
      ...monthly('Plano', SEP_AUG_JUL, 10, 10, { user_id: 'user-a' }),
      ...monthly('Plano', SEP_AUG_JUL, 10, 12, { user_id: 'user-b' }),
    ];
    expect(detect(data)).toHaveLength(2);
  });

  it('getOwnerId customizado define o dono', () => {
    const data = monthly('Plano', SEP_AUG_JUL).map((t, i) => ({ ...t, user_id: undefined, ID_Conta: `c${i}` }) as Transaction);
    const r = detectRecurrences({
      transactions: data,
      categories,
      today: TODAY,
      getOwnerId: (t) => (t.ID_Conta === 'c1' ? 'dono-2' : 'dono-1'),
    });
    expect(r).toEqual([]); // 1, 1 e 1 mês por dono: nenhum chega a 3
  });

  it('contas diferentes do mesmo dono → mesmo grupo, com accountCount correto', () => {
    const data = [
      tx('2026-07-10', 'Plano', 10, { ID_Conta: 'cartao-a' }),
      tx('2026-08-10', 'Plano', 10, { ID_Conta: 'cartao-b' }),
      tx('2026-09-10', 'Plano', 10, { ID_Conta: 'cartao-b' }),
    ];
    const r = detect(data);
    expect(r).toHaveLength(1);
    expect(r[0].accountCount).toBe(2);
    expect(detect(monthly('Plano', SEP_AUG_JUL))[0].accountCount).toBe(1);
  });

  it('categoria fora da chave: categorias diferentes continuam um grupo', () => {
    const data = [
      tx('2026-07-10', 'Plano', 10, { Categoria: 'Lazer' }),
      tx('2026-08-10', 'Plano', 10, { Categoria: 'Outros' }),
      tx('2026-09-10', 'Plano', 10, { Categoria: 'Saúde' }),
    ];
    expect(detect(data)).toHaveLength(1);
  });
});

describe('Valor típico e estabilidade', () => {
  const run = (valores: number[]) =>
    detect(valores.map((v, i) => tx(`2026-${String(9 - (valores.length - 1 - i)).padStart(2, '0')}-10`, 'Plano', v)))[0];

  it('mediana ímpar', () => {
    const c = run([10, 30, 20]);
    expect(c.typicalAmount).toBe(20);
    expect([c.minAmount, c.maxAmount]).toEqual([10, 30]);
  });

  it('mediana par: média dos dois centrais, em centavos', () => {
    expect(run([10, 11, 12, 13]).typicalAmount).toBe(11.5);
    expect(run([10.01, 10.02, 10.03, 10.04]).typicalAmount).toBe(10.03); // 10,025 → 10,03
    expect(run([0.01, 0.02, 0.03, 0.04]).typicalAmount).toBe(0.03);
  });

  it('a mediana resiste a um mês atípico', () => {
    expect(run([39.9, 39.9, 39.9, 399]).typicalAmount).toBe(39.9);
  });

  it('valores idênticos → stable', () => {
    const c = run([39.9, 39.9, 39.9]);
    expect(c.amountPattern).toBe('stable');
    expect(c.minAmount).toBe(c.maxAmount);
  });

  it('exatamente ±20% da mediana → stable (inclusivo)', () => {
    expect(run([80, 100, 120]).amountPattern).toBe('stable');
    expect(run([100, 100, 120]).amountPattern).toBe('stable');
  });

  it('fora de ±20% → variable, com faixa histórica', () => {
    const c = run([79.99, 100, 120]);
    expect(c.amountPattern).toBe('variable');
    expect([c.minAmount, c.maxAmount]).toEqual([79.99, 120]);
    expect(run([100, 100, 120.01]).amountPattern).toBe('variable');
  });

  it('variável continua candidato', () => {
    expect(run([50, 200, 90, 400])).toBeTruthy();
  });

  it('o sinal do Valor não altera nada: despesa positiva ou negativa dá o mesmo resultado', () => {
    const neg = detect(monthly('Plano', SEP_AUG_JUL, 39.9));
    const pos = detect(monthly('Plano', SEP_AUG_JUL, 39.9).map((t) => ({ ...t, Valor: Math.abs(t.Valor) }) as Transaction));
    expect(pos[0].typicalAmount).toBe(neg[0].typicalAmount);
    expect(pos[0].amountPattern).toBe(neg[0].amountPattern);
  });

  it('nunca NaN, Infinity ou -0', () => {
    const c = run([0.01, 0.01, 0.01]);
    for (const v of [c.typicalAmount, c.minAmount, c.maxAmount]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Object.is(v, -0)).toBe(false);
    }
    expect(JSON.stringify(detect(monthly('Plano', SEP_AUG_JUL)))).not.toMatch(/NaN|Infinity/);
  });
});

describe('Dia provável (só contexto)', () => {
  const days = (ds: number[]) =>
    detect(ds.map((d, i) => tx(`2026-0${7 + i}-${String(d).padStart(2, '0')}`, 'Plano', 10)))[0];

  it('10, 10, 10 → exato', () => {
    expect(days([10, 10, 10]).usualDay).toEqual({ kind: 'exact', day: 10 });
  });
  it('8, 10, 14 → faixa 8–14', () => {
    expect(days([8, 10, 14]).usualDay).toEqual({ kind: 'range', from: 8, to: 14 });
  });
  it('amplitude 8 (5, 10, 13) → sem dia; 5, 10, 20 → sem dia', () => {
    expect(days([5, 10, 13]).usualDay).toBeNull();
    expect(days([5, 10, 20]).usualDay).toBeNull();
  });
  it('a regularidade do dia não decide se é candidato', () => {
    expect(days([1, 15, 28])).toBeTruthy();
    expect(days([1, 15, 28]).usualDay).toBeNull();
  });
});

describe('Exclusões estruturais', () => {
  const none = (extra: Partial<Transaction>, name = 'Plano') =>
    expect(detect(monthly(name, SEP_AUG_JUL, 39.9, 10, extra))).toEqual([]);

  it('Renda', () => none({ Tipo: 'Renda', Categoria: 'Salário', Valor: 39.9 }));
  it('demo por Origem e por Fonte', () => {
    none({ Origem: 'demo.csv' });
    none({ Fonte: 'Demo' });
  });
  it('categoria Ambos', () => none({ Categoria: 'Movimentação' }));
  it('investimento', () => none({ Categoria: 'Aportes' }));
  it('Pagar (marcador em Descricao_Original e em Observacoes)', () => {
    none({ Descricao_Original: 'Pagamento Fatura finelo_funding_account:11111111-1111-1111-1111-111111111111' });
    none({ Observacoes: 'finelo_funding_account:abc' });
  });
  it('Parcela_Atual / Total_Parcelas', () => {
    none({ Parcela_Atual: 2 });
    none({ Total_Parcelas: 12 });
    none({ Parcela_Atual: 3, Total_Parcelas: 12 });
  });
  it('"(x/y)" no nome', () => {
    expect(detect(monthly('Notebook (3/12)', SEP_AUG_JUL))).toEqual([]);
  });
  it('valor zero, NaN e Infinity', () => {
    none({ Valor: 0 });
    none({ Valor: Number.NaN });
    none({ Valor: Number.POSITIVE_INFINITY });
  });
  it('uma parcela no meio da sequência não é contada, e a sequência cai abaixo de 3', () => {
    const data = [...monthly('Plano', ['2026-08', '2026-09']), tx('2026-07-10', 'Plano', 39.9, { Total_Parcelas: 10, Parcela_Atual: 1 })];
    expect(detect(data)).toEqual([]);
  });
});

describe('Cartão: usa Data, não Data_Pagamento', () => {
  it('compras em 10/jul, 10/ago, 10/set com vencimentos diferentes → candidato pela Data', () => {
    const data = [
      tx('2026-07-10', 'Plano', 10, { Data_Pagamento: '2026-08-15' as unknown as Date }),
      tx('2026-08-10', 'Plano', 10, { Data_Pagamento: '2026-09-15' as unknown as Date }),
      tx('2026-09-10', 'Plano', 10, { Data_Pagamento: '2026-10-15' as unknown as Date }),
    ];
    const r = detect(data);
    expect(r).toHaveLength(1);
    expect(r[0].lastOccurrenceDate).toBe('2026-09-10');
  });

  it('compras distintas no mesmo vencimento NÃO viram recorrência', () => {
    // Data_Pagamento igual em meses diferentes de compra: pela Data não há 3 meses
    const data = [
      tx('2026-09-01', 'Loja', 10, { Data_Pagamento: '2026-10-10' as unknown as Date }),
      tx('2026-09-12', 'Loja', 10, { Data_Pagamento: '2026-10-10' as unknown as Date }),
      tx('2026-09-25', 'Loja', 10, { Data_Pagamento: '2026-10-10' as unknown as Date }),
    ];
    expect(detect(data)).toEqual([]);
  });

  it('o dia provável sai da Data, não do vencimento', () => {
    const data = SEP_AUG_JUL.map((m) => tx(`${m}-05`, 'Plano', 10, { Data_Pagamento: `${m}-28` as unknown as Date }));
    expect(detect(data)[0].usualDay).toEqual({ kind: 'exact', day: 5 });
  });
});

describe('Futuro já registrado (pela Data)', () => {
  const base = () => monthly('Plano', SEP_AUG_JUL);

  it('lançamento com Data futura e mesma chave → true', () => {
    expect(detect([...base(), tx('2026-11-10', 'Plano', 39.9)])[0].hasFutureRegistered).toBe(true);
  });

  it('sem futuro → false; hoje não é futuro; mês atual passado não é futuro', () => {
    expect(detect(base())[0].hasFutureRegistered).toBe(false);
    expect(detect([...base(), tx('2026-10-06', 'Plano', 39.9)])[0].hasFutureRegistered).toBe(false);
    expect(detect([...base(), tx('2026-10-02', 'Plano', 39.9)])[0].hasFutureRegistered).toBe(false);
  });

  it('compra passada com Data_Pagamento futura NÃO ganha o selo', () => {
    const r = detect([...base(), tx('2026-09-28', 'Plano', 39.9, { Data_Pagamento: '2026-11-10' as unknown as Date })]);
    // (segunda ocorrência em setembro desqualificaria o grupo: usa outro mês passado fora da janela)
    expect(r).toEqual([]);
    const ok = detect([...base(), tx('2026-10-03', 'Plano', 39.9, { Data_Pagamento: '2026-11-10' as unknown as Date })]);
    expect(ok[0].hasFutureRegistered).toBe(false);
  });

  it('futuro que é parcela, demo, Pagar, investimento ou Ambos NÃO aciona o selo', () => {
    const futures = [
      tx('2026-11-10', 'Plano', 10, { Parcela_Atual: 2, Total_Parcelas: 6 }),
      tx('2026-11-10', 'Plano', 10, { Origem: 'demo.csv' }),
      tx('2026-11-10', 'Plano', 10, { Descricao_Original: 'x finelo_funding_account:abc' }),
      tx('2026-11-10', 'Plano', 10, { Categoria: 'Aportes' }),
      tx('2026-11-10', 'Plano', 10, { Categoria: 'Movimentação' }),
      tx('2026-11-10', 'Plano', 10, { Tipo: 'Renda', Categoria: 'Salário' }),
    ];
    for (const f of futures) expect(detect([...base(), f])[0].hasFutureRegistered, JSON.stringify(f.Categoria)).toBe(false);
  });

  it('futuro de outro dono ou de outro nome não aciona', () => {
    expect(detect([...base(), tx('2026-11-10', 'Plano', 10, { user_id: 'outro' })])[0].hasFutureRegistered).toBe(false);
    expect(detect([...base(), tx('2026-11-10', 'Outro nome', 10)])[0].hasFutureRegistered).toBe(false);
  });

  it('recorrência manual: 3 meses válidos + cópias futuras → candidato com selo', () => {
    const future = ['2026-11', '2026-12', '2027-01'].map((m) => tx(`${m}-10`, 'Plano', 39.9));
    const r = detect([...base(), ...future]);
    expect(r).toHaveLength(1);
    expect(r[0].hasFutureRegistered).toBe(true);
    expect(r[0].monthCount).toBe(3); // as cópias futuras não entram no histórico
  });

  it('futuro sozinho não cria candidato', () => {
    expect(detect(['2026-11', '2026-12', '2027-01'].map((m) => tx(`${m}-10`, 'Plano', 39.9)))).toEqual([]);
  });
});

describe('Ordenação determinística', () => {
  it('monthCount desc, depois valor típico desc, depois nome (pt-BR), dono e nome normalizado', () => {
    const data = [
      ...monthly('Beta', ['2026-05', '2026-06', '2026-07', '2026-09'], 10),
      ...monthly('Alfa', SEP_AUG_JUL, 100),
      ...monthly('Zeta', SEP_AUG_JUL, 100),
      ...monthly('Cara', SEP_AUG_JUL, 500),
      ...monthly('Ágata', SEP_AUG_JUL, 100),
    ];
    const order = detect(data).map((c) => c.displayName);
    expect(order).toEqual(['Beta', 'Cara', 'Ágata', 'Alfa', 'Zeta']);
    expect(detect([...data].reverse()).map((c) => c.displayName)).toEqual(order);
  });

  it('empate total (mesmo nome e valor, donos diferentes) não depende da entrada', () => {
    const data = [
      ...monthly('Plano', SEP_AUG_JUL, 10, 10, { user_id: 'b' }),
      ...monthly('Plano', SEP_AUG_JUL, 10, 10, { user_id: 'a' }),
    ];
    expect(detect(data).map((c) => c.ownerUserId)).toEqual(['a', 'b']);
    expect(detect([...data].reverse()).map((c) => c.ownerUserId)).toEqual(['a', 'b']);
  });
});

describe('Somente leitura e CTA', () => {
  it('não altera as transações recebidas', () => {
    const data = monthly('Plano', SEP_AUG_JUL);
    const before = JSON.stringify(data);
    detect(data);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('filtro do "Ver lançamentos": Despesa, Data, 12 meses completos, texto e dono', () => {
    const c = detect(monthly('Plano X', SEP_AUG_JUL, 10, 10, { user_id: 'user-a' }))[0];
    const patch = buildRecurrenceFilterPatch(c, getRecurrenceWindow(TODAY), { filterByOwner: true });
    expect(patch).toMatchObject({
      text: 'Plano X',
      type: 'Despesa',
      dateField: 'Data',
      periodPreset: 'custom',
      viewScope: 'operation',
      startDate: '2025-10-01',
      endDate: '2026-09-30',
      category: [],
      accountId: [],
      sourceScope: 'all',
      ownerUserId: 'user-a',
    });
    expect(patch.dateField).not.toBe('Pagamento');
    expect(buildRecurrenceFilterPatch(c, getRecurrenceWindow(TODAY), { filterByOwner: false }).ownerUserId).toBe('');
  });

  it('complexidade: 4 mil lançamentos rodam rápido (uma passada)', () => {
    const many: Transaction[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const m = 1 + (i % 9);
      many.push(tx(`2026-0${m}-${String(1 + (i % 27)).padStart(2, '0')}`, `Loja ${i % 700}`, 10 + (i % 50)));
    }
    const t0 = Date.now();
    detect(many);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
