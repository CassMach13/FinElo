import { describe, expect, it } from 'vitest';
import {
  computeGoalProgress,
  deadlineFromMonth,
  formatDeadlineLabel,
  parseMoneyInput,
  splitAndSortGoals,
  validateGoalForm,
} from '../../src/domain/goals/goalProgress';

const TODAY = '2026-10-06';
const g = (target: number, current: number, extra: Record<string, unknown> = {}) => ({
  target_amount: target,
  current_amount: current,
  ...extra,
});
const p = (target: number, current: number, date: string | null = null, today = TODAY) =>
  computeGoalProgress({ target_amount: target, current_amount: current, target_date: date }, today);

describe('Objetivos — progresso e valor restante', () => {
  it('0%, 50% e 100%', () => {
    expect(p(1000, 0)).toMatchObject({ progressPercent: 0, remainingAmount: 1000, isReached: false });
    expect(p(1000, 500)).toMatchObject({ progressPercent: 50, remainingAmount: 500, isReached: false });
    expect(p(1000, 1000)).toMatchObject({ progressPercent: 100, remainingAmount: 0, isReached: true });
  });

  it('99,96% é exibido como 99,9% e não vira 100% antes de atingir', () => {
    const r = p(10000, 9996);
    expect(r.progressPercent).toBe(99.9);
    expect(r.isReached).toBe(false);
    const r2 = p(100000, 99999.99);
    expect(r2.progressPercent).toBe(99.9);
    expect(r2.progressPercent).toBeLessThan(100);
    expect(r2.remainingAmount).toBe(0.01);
  });

  it('acima do alvo: percentual de domínio passa de 100, barra fica em 100, excedente informado', () => {
    const r = p(1000, 1500);
    expect(r.progressPercent).toBe(150);
    expect(r.progressBarPercent).toBe(100);
    expect(r.remainingAmount).toBe(0);
    expect(r.exceededAmount).toBe(500);
    expect(r.isReached).toBe(true);
  });

  it('centavos sem deriva de ponto flutuante', () => {
    expect(p(0.3, 0.1).remainingAmount).toBe(0.2);
    expect(p(100.1, 100.05).remainingAmount).toBe(0.05);
    expect(p(1234567.89, 1234567.88).remainingAmount).toBe(0.01);
  });

  it('valores gigantes (14 dígitos) não estouram a precisão', () => {
    const r = p(999999999999.99, 999999999999.98);
    expect(r.progressPercent).toBe(99.9);
    expect(r.remainingAmount).toBe(0.01);
  });

  it('nunca NaN, Infinity ou -0, nem com entrada inválida', () => {
    const bad: Array<[number, number]> = [
      [0, 0], [-5, 10], [Number.NaN, 5], [100, Number.NaN], [Number.POSITIVE_INFINITY, 1], [100, -50], [100, Number.POSITIVE_INFINITY],
    ];
    for (const [t, c] of bad) {
      const r = p(t, c, '2027-12-31');
      for (const v of Object.values(r)) {
        if (typeof v === 'number') {
          expect(Number.isFinite(v), `${t}/${c}`).toBe(true);
          expect(Object.is(v, -0), `${t}/${c}`).toBe(false);
        }
      }
      expect(r.isReached).toBe(false);
    }
    expect(Object.is(p(100, 100).remainingAmount, -0)).toBe(false);
  });
});

describe('Objetivos — status derivado', () => {
  it('alcançado volta a ativo se o valor cair', () => {
    expect(p(1000, 1000).isReached).toBe(true);
    expect(p(1000, 999.99).isReached).toBe(false);
  });

  it('arquivado vem de archived_at, independente do progresso', () => {
    expect(computeGoalProgress(g(100, 0, { archived_at: '2026-10-01T00:00:00Z' }), TODAY).isArchived).toBe(true);
    expect(computeGoalProgress(g(100, 100, { archived_at: null }), TODAY).isArchived).toBe(false);
  });

  it('"prazo encerrado" é rótulo derivado: só mês anterior ao atual e não alcançado', () => {
    expect(p(1000, 0, '2026-09-30').isExpired).toBe(true);
    expect(p(1000, 0, '2026-10-31').isExpired).toBe(false); // prazo neste mês
    expect(p(1000, 1000, '2026-09-30').isExpired).toBe(false); // alcançado
    expect(p(1000, 0, null).isExpired).toBe(false);
  });
});

describe('Objetivos — meses restantes e valor mensal', () => {
  it('out/2026 → dez/2027 = 14 meses (nov/2026 a dez/2027), mês atual fora', () => {
    expect(p(14000, 0, '2027-12-31').monthsRemaining).toBe(14);
    expect(p(14000, 0, '2027-12-31').monthlyNeeded).toBe(1000);
  });

  it('próximo mês = 1; prazo neste mês = 0 sem dividir', () => {
    expect(p(500, 0, '2026-11-30').monthsRemaining).toBe(1);
    expect(p(500, 0, '2026-11-30').monthlyNeeded).toBe(500);
    const now = p(500, 100, '2026-10-31');
    expect(now.monthsRemaining).toBe(0);
    expect(now.monthlyNeeded).toBeNull();
    expect(now.remainingAmount).toBe(400);
  });

  it('virada de ano e fevereiro', () => {
    expect(p(300, 0, '2027-01-31', '2026-12-15').monthsRemaining).toBe(1);
    expect(p(300, 0, '2027-02-28', '2026-12-15').monthsRemaining).toBe(2);
    expect(p(300, 0, '2028-02-29', '2028-01-31').monthsRemaining).toBe(1);
  });

  it('prazo vencido: sem valor mensal', () => {
    const r = p(1000, 0, '2026-05-31');
    expect(r.monthsRemaining).toBeLessThan(0);
    expect(r.monthlyNeeded).toBeNull();
    expect(r.isExpired).toBe(true);
  });

  it('sem prazo: sem meses e sem valor mensal', () => {
    const r = p(1000, 0, null);
    expect(r.hasDeadline).toBe(false);
    expect(r.monthsRemaining).toBeNull();
    expect(r.monthlyNeeded).toBeNull();
    expect(r.remainingAmount).toBe(1000);
  });

  it('alcançado: sem valor mensal', () => {
    expect(p(1000, 1000, '2027-12-31').monthlyNeeded).toBeNull();
  });

  it('arredonda o mensal PARA CIMA: repetido, nunca fica abaixo do que falta', () => {
    const cases: Array<[number, number, string]> = [
      [100, 0, '2027-01-31'], // 3 meses → 33,34
      [1000, 0, '2027-04-30'], // 6 meses → 166,67
      [0.01, 0, '2027-12-31'], // 14 meses → 0,01
      [200.01, 0.5, '2027-03-31'], // 5 meses
    ];
    for (const [t, c, d] of cases) {
      const r = p(t, c, d);
      const months = r.monthsRemaining as number;
      const totalCents = Math.round((r.monthlyNeeded as number) * 100) * months;
      const remainingCents = Math.round(r.remainingAmount * 100);
      expect(totalCents).toBeGreaterThanOrEqual(remainingCents);
      expect(totalCents - remainingCents).toBeLessThan(months); // sobra menos que 1 centavo por mês
    }
    expect(p(100, 0, '2027-01-31').monthlyNeeded).toBe(33.34);
    expect(p(1000, 0, '2027-04-30').monthlyNeeded).toBe(166.67);
    expect(p(0.01, 0, '2027-12-31').monthlyNeeded).toBe(0.01);
  });
});

describe('Objetivos — prazo (mês/ano → último dia)', () => {
  it('último dia do mês, inclusive fevereiro bissexto', () => {
    expect(deadlineFromMonth('2027-12')).toBe('2027-12-31');
    expect(deadlineFromMonth('2027-02')).toBe('2027-02-28');
    expect(deadlineFromMonth('2028-02')).toBe('2028-02-29');
    expect(deadlineFromMonth('2026-04')).toBe('2026-04-30');
    expect(deadlineFromMonth('')).toBeNull();
    expect(deadlineFromMonth('2026-13')).toBeNull();
    expect(formatDeadlineLabel('2027-12-31')).toBe('dez/2027');
  });
});

describe('Objetivos — valor digitado', () => {
  it('aceita formatos brasileiros e simples', () => {
    expect(parseMoneyInput('1234')).toBe(1234);
    expect(parseMoneyInput('1234,56')).toBe(1234.56);
    expect(parseMoneyInput('1.234,56')).toBe(1234.56);
    expect(parseMoneyInput('1234.56')).toBe(1234.56);
    expect(parseMoneyInput('1,234.56')).toBe(1234.56);
    expect(parseMoneyInput('R$ 30.000')).toBe(30000);
    expect(parseMoneyInput('12.5')).toBe(12.5);
    expect(parseMoneyInput('0,1')).toBe(0.1);
    expect(parseMoneyInput('10,005')).toBe(10.01);
  });
  it('rejeita o que não é número', () => {
    for (const v of ['', 'abc', '1a', '--', null, undefined, Number.NaN]) {
      expect(parseMoneyInput(v as never)).toBeNull();
    }
  });
});

describe('Objetivos — validação do formulário', () => {
  const create = (o: Partial<Parameters<typeof validateGoalForm>[0]> = {}) =>
    validateGoalForm(
      { name: 'Viagem', target: '15000', current: '8000', month: '2027-05', ...o },
      { mode: 'create', today: TODAY }
    );

  it('criação válida normaliza valores e prazo', () => {
    const r = create({ target: '15.000,50', current: '' });
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({ name: 'Viagem', target_amount: 15000.5, current_amount: 0, target_date: '2027-05-31' });
  });

  it('nome vazio, só espaços e >80', () => {
    expect(create({ name: '' }).errors.name).toBeTruthy();
    expect(create({ name: '   ' }).errors.name).toBeTruthy();
    expect(create({ name: 'a'.repeat(81) }).errors.name).toBeTruthy();
    expect(create({ name: 'a'.repeat(80) }).errors.name).toBeUndefined();
    expect(create({ name: '  Reserva  ' }).value?.name).toBe('Reserva');
  });

  it('valor desejado precisa ser > 0 e atual ≥ 0', () => {
    for (const t of ['0', '-10', 'abc', '']) expect(create({ target: t }).errors.target, t).toBeTruthy();
    expect(create({ current: '-1' }).errors.current).toBeTruthy();
    expect(create({ current: 'x' }).errors.current).toBeTruthy();
    expect(create({ current: '0' }).errors.current).toBeUndefined();
  });

  it('valor atual maior que o alvo é permitido', () => {
    expect(create({ target: '1000', current: '5000' }).errors).toEqual({});
  });

  it('prazo opcional; mês atual e futuro aceitos; passado bloqueado na criação', () => {
    expect(create({ month: '' }).value?.target_date).toBeNull();
    expect(create({ month: '2026-10' }).value?.target_date).toBe('2026-10-31');
    expect(create({ month: '2026-11' }).errors.month).toBeUndefined();
    expect(create({ month: '2026-09' }).errors.month).toBeTruthy();
    expect(create({ month: '2025-12' }).errors.month).toBeTruthy();
    expect(create({ month: '2026-99' }).errors.month).toBeTruthy();
  });

  it('edição: não pede valor atual e mantém prazo vencido sem forçar mudança', () => {
    const edit = (month: string) =>
      validateGoalForm(
        { name: 'Curso', target: '2000', month },
        { mode: 'edit', today: TODAY, existingTargetDate: '2026-03-31' }
      );
    const unchanged = edit('2026-03');
    expect(unchanged.errors).toEqual({});
    expect(unchanged.value).toEqual({ name: 'Curso', target_amount: 2000, target_date: '2026-03-31' });
    expect(unchanged.value).not.toHaveProperty('current_amount');
    expect(edit('2026-04').errors.month).toBeTruthy(); // mudar para outro mês passado continua bloqueado
    expect(edit('2027-01').errors.month).toBeUndefined();
    expect(edit('').value?.target_date).toBeNull(); // pode remover o prazo
  });
});

describe('Objetivos — ordenação', () => {
  const goal = (id: string, name: string, current: number, date: string | null, archivedAt: string | null = null) => ({
    id, name, target_amount: 100, current_amount: current, target_date: date, archived_at: archivedAt,
  });

  it('ativos por prazo (sem prazo depois), nome e id; alcançados depois; arquivados à parte', () => {
    const goals = [
      goal('6', 'Sem prazo B', 0, null),
      goal('1', 'Alcançado cedo', 100, '2026-11-30'),
      goal('3', 'Viagem', 0, '2027-05-31'),
      goal('2', 'Reserva', 0, '2026-12-31'),
      goal('5', 'Sem prazo A', 0, null),
      goal('4', 'Casa', 0, '2027-05-31'),
      goal('8', 'Antigo', 0, null, '2026-08-01T00:00:00Z'),
      goal('9', 'Recente', 0, null, '2026-09-01T00:00:00Z'),
    ];
    const { main, archived } = splitAndSortGoals(goals);
    expect(main.map((x) => x.id)).toEqual(['2', '4', '3', '5', '6', '1']);
    expect(archived.map((x) => x.id)).toEqual(['9', '8']);
    expect(splitAndSortGoals([...goals].reverse()).main.map((x) => x.id)).toEqual(main.map((x) => x.id));
  });

  it('desempate final por id quando nome e prazo são iguais', () => {
    const { main } = splitAndSortGoals([goal('b', 'Igual', 0, null), goal('a', 'Igual', 0, null)]);
    expect(main.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
