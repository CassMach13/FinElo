import { describe, expect, it } from 'vitest';
import {
  formatCompactPeriodLabel,
  formatDashboardPeriodLabel,
  getDashboardDateRange,
} from '../../src/utils/dashboardPeriod';
import {
  DASHBOARD_PRINT_TITLE,
  buildDashboardPrintHeader,
  formatPrintDate,
  formatPrintRange,
} from '../../src/utils/dashboardPrintHeader';

/**
 * O cabeçalho de impressão da Dashboard responde "de quando são estes números?".
 * Os intervalos vêm de `getDashboardDateRange` (o mesmo que a tela usa), com datas
 * fixas — nada aqui depende do dia em que o teste roda.
 */

const periodo = (
  viewMode: Parameters<typeof getDashboardDateRange>[0]['viewMode'],
  selectedDate: Date,
  customDateRange?: { start: string; end: string }
) => {
  const range = getDashboardDateRange({ viewMode, selectedDate, customDateRange });
  return { label: formatDashboardPeriodLabel(viewMode, range), range };
};

describe('intervalo em dd/mm/aaaa', () => {
  it('formata um dia com zeros à esquerda', () => {
    expect(formatPrintDate(new Date(2026, 0, 5))).toBe('05/01/2026');
    expect(formatPrintDate(new Date(2026, 11, 31))).toBe('31/12/2026');
  });

  it('o fim do intervalo (23:59:59) não vira o dia seguinte', () => {
    const { range } = periodo('monthly', new Date(2026, 8, 15));
    expect(range.end.getHours()).toBe(23);
    expect(formatPrintDate(range.end)).toBe('30/09/2026');
  });

  it('junta início e fim com "a"', () => {
    const { range } = periodo('monthly', new Date(2026, 8, 15));
    expect(formatPrintRange(range)).toBe('01/09/2026 a 30/09/2026');
  });
});

describe('período mensal', () => {
  it('mostra o rótulo e o intervalo exato do mês', () => {
    const header = buildDashboardPrintHeader(periodo('monthly', new Date(2026, 8, 15)));
    expect(header.period).toBe('Período: setembro de 2026 (01/09/2026 a 30/09/2026)');
  });

  it('fevereiro bissexto vai até 29', () => {
    const header = buildDashboardPrintHeader(periodo('monthly', new Date(2028, 1, 10)));
    expect(header.period).toContain('(01/02/2028 a 29/02/2028)');
  });

  it('fevereiro comum vai até 28', () => {
    const header = buildDashboardPrintHeader(periodo('monthly', new Date(2026, 1, 10)));
    expect(header.period).toContain('(01/02/2026 a 28/02/2026)');
  });

  it('o rótulo é o mesmo que a tela usa (nenhuma segunda lógica de período)', () => {
    const p = periodo('monthly', new Date(2026, 8, 15));
    const header = buildDashboardPrintHeader(p);
    expect(header.period).toContain(formatDashboardPeriodLabel('monthly', p.range));
  });
});

describe('outras granularidades e período personalizado', () => {
  it('anual', () => {
    const header = buildDashboardPrintHeader(periodo('yearly', new Date(2026, 5, 1)));
    expect(header.period).toBe('Período: 2026 (01/01/2026 a 31/12/2026)');
  });

  it('trimestral cobre os três meses', () => {
    const header = buildDashboardPrintHeader(periodo('quarterly', new Date(2026, 7, 10)));
    expect(header.period).toContain('(01/07/2026 a 30/09/2026)');
  });

  it('semestral cobre os seis meses', () => {
    const header = buildDashboardPrintHeader(periodo('semiannual', new Date(2026, 8, 10)));
    expect(header.period).toContain('(01/07/2026 a 31/12/2026)');
  });

  it('personalizado usa exatamente as datas escolhidas — nada inventado', () => {
    const header = buildDashboardPrintHeader(
      periodo('custom', new Date(2026, 8, 1), { start: '2026-08-15', end: '2026-09-10' })
    );
    expect(header.period).toContain('(15/08/2026 a 10/09/2026)');
  });

  it('personalizado de um único dia', () => {
    const header = buildDashboardPrintHeader(
      periodo('custom', new Date(2026, 8, 1), { start: '2026-09-10', end: '2026-09-10' })
    );
    expect(header.period).toContain('(10/09/2026 a 10/09/2026)');
  });

  it('o intervalo impresso é sempre o real do período, nunca o "de hoje"', () => {
    const hoje = new Date();
    const header = buildDashboardPrintHeader(periodo('monthly', new Date(2020, 2, 15)));
    expect(header.period).toContain('01/03/2020 a 31/03/2020');
    expect(header.period).not.toContain(String(hoje.getFullYear()));
  });
});

describe('comparação de períodos', () => {
  it('sem comparação não existe a linha de comparação', () => {
    const header = buildDashboardPrintHeader(periodo('monthly', new Date(2026, 8, 15)), null);
    expect(header.compare).toBeUndefined();
    expect('compare' in header).toBe(false);
  });

  it('com comparação mostra o período comparado com o seu intervalo', () => {
    const header = buildDashboardPrintHeader(
      periodo('monthly', new Date(2026, 8, 15)),
      periodo('monthly', new Date(2026, 7, 15))
    );
    expect(header.period).toBe('Período: setembro de 2026 (01/09/2026 a 30/09/2026)');
    expect(header.compare).toBe('Comparado com: agosto de 2026 (01/08/2026 a 31/08/2026)');
  });

  it('ano contra ano', () => {
    const header = buildDashboardPrintHeader(
      periodo('monthly', new Date(2026, 8, 15)),
      periodo('monthly', new Date(2025, 8, 15))
    );
    expect(header.compare).toContain('setembro de 2025 (01/09/2025 a 30/09/2025)');
  });
});

describe('título', () => {
  it('sempre identifica o documento', () => {
    const header = buildDashboardPrintHeader(periodo('monthly', new Date(2026, 8, 15)));
    expect(header.title).toBe(DASHBOARD_PRINT_TITLE);
    expect(DASHBOARD_PRINT_TITLE).toContain('FinElo');
  });

  it('formatCompactPeriodLabel segue sendo o rótulo curto da tela, não o do PDF', () => {
    const { range } = periodo('monthly', new Date(2026, 8, 15));
    expect(formatCompactPeriodLabel(range)).toBe('set/26');
    expect(buildDashboardPrintHeader({ label: 'x', range }).period).not.toContain('set/26');
  });
});
