/**
 * Vencimento de fatura e o dia em que ele é efetivamente pago.
 *
 * Vencimento que cai em sábado ou domingo é pago na segunda-feira seguinte, sem
 * encargo. O cartão de referência deste módulo vence no dia 18: em 2026 o dia
 * 18 caiu num sábado em julho e num domingo em outubro, e a fatura foi
 * registrada com vencimento 20/07 e 19/10. Tratar essas datas como «não é
 * vencimento» empurrava a fatura inteira para a competência seguinte.
 *
 * Feriados não entram aqui: exigiriam calendário bancário, e uma tabela
 * incompleta erraria em silêncio. Só o fim de semana, que é certo.
 *
 * Datas civis AAAA-MM-DD, aritmética em UTC para não depender do fuso.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoUtc(iso: string): Date | null {
  const m = ISO_DATE_RE.exec(String(iso || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return d;
}

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Dia em que o vencimento é pago: o próprio dia, ou a segunda-feira se cair no fim de semana. */
export function effectiveDueDateIso(nominalDueIso: string): string {
  const d = parseIsoUtc(nominalDueIso);
  if (!d) return nominalDueIso;
  const weekday = d.getUTCDay();
  if (weekday === 6) return toIso(addDays(d, 2));
  if (weekday === 0) return toIso(addDays(d, 1));
  return toIso(d);
}

/**
 * Se `paidOnIso` é um dia de vencimento do cartão — o dia cadastrado, ou a
 * segunda-feira que o substitui quando ele cai no fim de semana —, devolve o
 * vencimento NOMINAL. Senão, null.
 *
 * Devolver o nominal, e não a segunda-feira, importa na virada do mês: um
 * vencimento no dia 31 de um sábado é pago no dia 2 do mês seguinte, e a
 * competência tem de sair do mês do vencimento, não do mês do pagamento.
 */
export function nominalDueDateForPaidOn(paidOnIso: string, dueDay: number): string | null {
  const d = parseIsoUtc(paidOnIso);
  if (!d || !Number.isInteger(dueDay) || dueDay < 1) return null;
  if (d.getUTCDate() === dueDay) return toIso(d);
  if (d.getUTCDay() !== 1) return null;
  for (const back of [1, 2]) {
    const candidate = addDays(d, -back);
    const weekday = candidate.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    if (isWeekend && candidate.getUTCDate() === dueDay) return toIso(candidate);
  }
  return null;
}
