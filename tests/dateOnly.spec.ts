import { describe, expect, it } from 'vitest';
import {
  addMonthsToDateOnly,
  formatDateOnlyPtBr,
  localTodayIso,
  parseDateOnlyLocal,
  toDateOnlyIso,
} from '../src/utils/dateOnly';

describe('dateOnly', () => {
  it('preserva o dia civil de strings vindas de coluna date do Supabase', () => {
    expect(toDateOnlyIso('2026-08-01')).toBe('2026-08-01');
    expect(formatDateOnlyPtBr('2026-08-01')).toBe('01/08/2026');
    expect(parseDateOnlyLocal('2026-08-01')?.getDate()).toBe(1);
  });

  it('preserva input ISO materializado como meia-noite UTC', () => {
    expect(toDateOnlyIso(new Date('2026-08-01'))).toBe('2026-08-01');
  });

  it('gera hoje pelos componentes locais, sem depender do dia UTC', () => {
    expect(localTodayIso(new Date(2026, 7, 1, 23, 30))).toBe('2026-08-01');
  });

  it('recusa datas civis impossíveis', () => {
    expect(toDateOnlyIso('2026-02-31')).toBe('');
  });

  it('soma meses sem deslocamento de fuso e limita ao último dia válido', () => {
    expect(addMonthsToDateOnly('2026-03-01', 1)).toBe('2026-04-01');
    expect(addMonthsToDateOnly('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDateOnly('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsToDateOnly('2024-01-31', 1)).toBe('2024-02-29');
  });
});
