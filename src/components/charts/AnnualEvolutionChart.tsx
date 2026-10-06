import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnualEvolutionMonth } from '../../utils/annualEvolution';
import { formatCurrency } from '../../utils/formatters';

/**
 * Quatro linhas (entradas/saídas × ano atual/anterior) em SVG nativo: o projeto não usa
 * biblioteca de gráficos. Cor = natureza (entradas `accent`, saídas `danger`); traço = ano
 * (sólido atual, tracejado anterior). Recebe o modelo agregado, nunca transações.
 */

export const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTH_LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

interface Props {
  months: AnnualEvolutionMonth[];
  currentYear: number;
  previousYear: number;
}

const DEFAULT_WIDTH = 640;
const PAD = { top: 12, right: 12, bottom: 26, left: 52 };
const TOOLTIP_WIDTH = 190;

const compactBRL = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/** Teto "redondo" para o eixo Y e 4 divisões. */
export function niceAxis(max: number): { top: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };
  const exponent = Math.floor(Math.log10(max));
  const base = 10 ** exponent;
  const steps = [1, 2, 2.5, 5, 10];
  const step = (steps.find((s) => s * base * 4 >= max) ?? 10) * base;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v);
  return { top, ticks };
}

type SeriesKey = 'incomeCurrent' | 'incomePrevious' | 'expenseCurrent' | 'expensePrevious';

const SERIES: Array<{ key: SeriesKey; tone: 'text-accent' | 'text-danger'; dashed: boolean }> = [
  { key: 'incomePrevious', tone: 'text-accent', dashed: true },
  { key: 'expensePrevious', tone: 'text-danger', dashed: true },
  { key: 'incomeCurrent', tone: 'text-accent', dashed: false },
  { key: 'expenseCurrent', tone: 'text-danger', dashed: false },
];

const AnnualEvolutionChart: React.FC<Props> = ({ months, currentYear, previousYear }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = width < 520 ? 220 : 260;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  const { top, ticks } = useMemo(
    () =>
      niceAxis(
        Math.max(
          0,
          ...months.flatMap((m) => [m.incomeCurrent, m.incomePrevious, m.expenseCurrent, m.expensePrevious])
        )
      ),
    [months]
  );

  const n = months.length;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;
  const labelEvery = innerW / Math.max(1, n - 1) < 34 ? 2 : 1;

  const path = (key: SeriesKey) =>
    months.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(m[key]).toFixed(1)}`).join(' ');

  const activeMonth = active !== null ? months[active] : null;
  const tooltipLeft =
    active === null ? 0 : Math.min(Math.max(x(active) - TOOLTIP_WIDTH / 2, 0), Math.max(0, width - TOOLTIP_WIDTH));

  const describe = (m: AnnualEvolutionMonth) =>
    `${MONTH_LONG[m.month - 1]}: entradas ${currentYear} ${formatCurrency(m.incomeCurrent)}, entradas ${previousYear} ${formatCurrency(m.incomePrevious)}, saídas ${currentYear} ${formatCurrency(m.expenseCurrent)}, saídas ${previousYear} ${formatCurrency(m.expensePrevious)}`;

  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-300 mb-3" aria-label="Legenda do gráfico">
        {[
          { label: `Entradas ${currentYear}`, tone: 'text-accent', dashed: false },
          { label: `Entradas ${previousYear}`, tone: 'text-accent', dashed: true },
          { label: `Saídas ${currentYear}`, tone: 'text-danger', dashed: false },
          { label: `Saídas ${previousYear}`, tone: 'text-danger', dashed: true },
        ].map((item) => (
          <li key={item.label} className="flex items-center gap-1.5 min-w-0">
            <svg width="22" height="8" aria-hidden="true" className={`${item.tone} shrink-0`}>
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={item.dashed ? '4 3' : undefined}
              />
            </svg>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      <div ref={wrapRef} className="relative w-full min-w-0" onMouseLeave={() => setActive(null)}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Entradas e saídas registradas por mês, ${currentYear} comparado com ${previousYear}`}
          className="block max-w-full"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="currentColor"
                className="text-white/10"
                strokeWidth="1"
              />
              <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-gray-500" fontSize="11">
                {compactBRL(tick)}
              </text>
            </g>
          ))}

          {months.map((m, i) =>
            i % labelEvery === 0 ? (
              <text key={m.month} x={x(i)} y={height - 8} textAnchor="middle" className="fill-gray-400" fontSize="11">
                {MONTH_SHORT[m.month - 1]}
              </text>
            ) : null
          )}

          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="currentColor"
              className="text-white/20"
              strokeWidth="1"
            />
          )}

          {SERIES.map((s) => (
            <g key={s.key} className={s.tone}>
              <path
                d={path(s.key)}
                fill="none"
                stroke="currentColor"
                strokeWidth={s.dashed ? 2 : 2.5}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {months.map((m, i) => (
                <circle
                  key={m.month}
                  cx={x(i)}
                  cy={y(m[s.key])}
                  r={active === i ? 4 : 2.5}
                  fill="currentColor"
                  opacity={s.dashed ? 0.7 : 1}
                />
              ))}
            </g>
          ))}

          {months.map((m, i) => {
            const slot = n === 1 ? innerW : innerW / (n - 1);
            return (
              <rect
                key={m.month}
                x={x(i) - slot / 2}
                y={PAD.top}
                width={slot}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={describe(m)}
                className="cursor-pointer outline-none focus-visible:stroke-white/40"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => setActive((cur) => (cur === i ? null : i))}
              />
            );
          })}
        </svg>

        {activeMonth && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-white/10 bg-primary/95 p-2.5 text-xs shadow-xl"
            style={{ left: tooltipLeft, width: TOOLTIP_WIDTH }}
          >
            <p className="mb-1.5 font-semibold capitalize text-white">{MONTH_LONG[activeMonth.month - 1]}</p>
            <dl className="space-y-1 tabular-nums">
              {[
                { label: `Entradas ${currentYear}`, value: activeMonth.incomeCurrent, tone: 'text-accent' },
                { label: `Entradas ${previousYear}`, value: activeMonth.incomePrevious, tone: 'text-accent' },
                { label: `Saídas ${currentYear}`, value: activeMonth.expenseCurrent, tone: 'text-danger' },
                { label: `Saídas ${previousYear}`, value: activeMonth.expensePrevious, tone: 'text-danger' },
              ].map((row) => (
                <div key={row.label} className="flex justify-between gap-2">
                  <dt className="text-gray-400">{row.label}</dt>
                  <dd className={`font-semibold ${row.tone}`}>{formatCurrency(row.value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>{`Entradas e saídas registradas por mês, ${currentYear} e ${previousYear}`}</caption>
        <thead>
          <tr>
            <th scope="col">Mês</th>
            <th scope="col">{`Entradas ${currentYear}`}</th>
            <th scope="col">{`Entradas ${previousYear}`}</th>
            <th scope="col">{`Saídas ${currentYear}`}</th>
            <th scope="col">{`Saídas ${previousYear}`}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{MONTH_LONG[m.month - 1]}</th>
              <td>{formatCurrency(m.incomeCurrent)}</td>
              <td>{formatCurrency(m.incomePrevious)}</td>
              <td>{formatCurrency(m.expenseCurrent)}</td>
              <td>{formatCurrency(m.expensePrevious)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AnnualEvolutionChart;
