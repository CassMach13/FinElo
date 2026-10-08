import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildSmoothGappedArea, buildSmoothGappedPath, splitSegments } from '../charts/AnnualEvolutionChart';
import { formatCurrency } from '../../utils/formatters';
import {
  NO_POSITION_LABEL,
  computeYScale,
  formatMonthLabel,
  formatMonthShort,
  type MonthPoint,
} from '../../domain/investments/portfolioOverview';

/**
 * Evolução do saldo investido em SVG nativo (sem biblioteca). Mesma linguagem da Evolução anual: curva suave,
 * brilho sutil, grid discreto, tooltip premium. Uma série; mês sem posição vira BURACO (nunca R$ 0, nunca
 * interpolação). Recebe a série já agregada: nenhuma regra financeira vive aqui.
 */

export const PORTFOLIO_COLOR = '#49d2c7';
const DEFAULT_WIDTH = 800;
const PAD = { top: 16, right: 14, bottom: 26, left: 52 };
const SURFACE = '#0e1622';

const compactBRL = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export function chartHeight(width: number): number {
  return width < 520 ? 230 : Math.min(300, Math.max(230, Math.round(width * 0.36)));
}

export interface ChartGeometry {
  scale: ReturnType<typeof computeYScale>;
  points: Array<{ x: number; y: number } | null>;
  path: string;
  area: string;
  /** Pontos de trechos com um único mês (a curva não os desenha). */
  isolated: Array<{ x: number; y: number }>;
}

/** Geometria pura: o buraco (balance null) separa os trechos. */
export function buildChartGeometry(months: readonly MonthPoint[], width: number, height: number): ChartGeometry {
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const values = months.flatMap((m) => (m.balance === null ? [] : [m.balance]));
  const scale = computeYScale(values);
  const n = months.length;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => PAD.top + innerH - ((v - scale.min) / (scale.max - scale.min)) * innerH;
  const points = months.map((m, i) => (m.balance === null ? null : { x: x(i), y: y(m.balance) }));
  const bounds = { yMin: PAD.top, yMax: PAD.top + innerH };
  return {
    scale,
    points,
    path: buildSmoothGappedPath(points, bounds),
    area: buildSmoothGappedArea(points, PAD.top + innerH, bounds),
    isolated: splitSegments(points).filter((s) => s.length === 1).map((s) => s[0]),
  };
}

export function describeMonth(m: MonthPoint): string {
  return m.balance === null
    ? `${formatMonthLabel(m.key)}: ${NO_POSITION_LABEL}`
    : `${formatMonthLabel(m.key)}: saldo registrado ${formatCurrency(m.balance)}, ${m.positionCount} ${m.positionCount === 1 ? 'posição' : 'posições'}`;
}

interface Props {
  months: MonthPoint[];
  selectedKey: string;
}

const PortfolioHistoryChart: React.FC<Props> = ({ months, selectedKey }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Array<SVGRectElement | null>>([]);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '_');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [active, setActive] = useState<number | null>(null);

  const hasAnyData = months.some((m) => m.balance !== null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasAnyData]);

  // Troca de mês/sessão: o índice ativo anterior não vale mais para a nova janela.
  useEffect(() => setActive(null), [selectedKey]);

  const height = chartHeight(width);
  const geometry = useMemo(() => buildChartGeometry(months, width, height), [months, width, height]);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const n = months.length;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => PAD.top + innerH - ((v - geometry.scale.min) / (geometry.scale.max - geometry.scale.min)) * innerH;
  const labelEvery = innerW / Math.max(1, n - 1) < 34 ? 2 : 1;
  const stroke = width <= 760 ? 2 : 2.65;

  const activeMonth = active !== null ? months[active] : null;
  const TOOLTIP_WIDTH = width < 520 ? 184 : 204;
  const tooltipLeft = active === null ? 0 : Math.min(Math.max(x(active) - TOOLTIP_WIDTH / 2, 0), Math.max(0, width - TOOLTIP_WIDTH));

  const focusSlot = (i: number) => slotRefs.current[Math.min(Math.max(i, 0), n - 1)]?.focus();
  const onKeyDown = (event: React.KeyboardEvent, i: number) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); focusSlot(i + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); focusSlot(i - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusSlot(0); }
    else if (event.key === 'End') { event.preventDefault(); focusSlot(n - 1); }
    else if (event.key === 'Escape') setActive(null);
  };

  return (
    <section aria-label="Evolução do saldo investido" data-portfolio-chart="" className="min-w-0 rounded-2xl border border-slate-700/50 bg-secondary p-4 shadow-xl sm:p-6">
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Últimos 12 meses</p>
        <h2 className="text-lg font-semibold text-white">Evolução do saldo investido</h2>
        <p className="text-xs text-gray-500">Saldo registrado por mês. Meses sem posição ficam em branco.</p>
      </div>

      {!hasAnyData ? (
        <div data-chart-empty="" className="rounded-xl border border-dashed border-slate-700/60 px-4 py-10 text-center text-sm text-gray-400">
          Nenhuma posição registrada nos 12 meses até {formatMonthLabel(selectedKey)}.
        </div>
      ) : (
        <>
          <div ref={wrapRef} className="relative w-full min-w-0" onMouseLeave={() => setActive(null)}>
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label="Saldo investido registrado por mês nos últimos 12 meses"
              className="block max-w-full"
            >
              <defs>
                <linearGradient id={`pf-area-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PORTFOLIO_COLOR} stopOpacity="0.2" />
                  <stop offset="70%" stopColor={PORTFOLIO_COLOR} stopOpacity="0.025" />
                  <stop offset="100%" stopColor={PORTFOLIO_COLOR} stopOpacity="0" />
                </linearGradient>
                <filter id={`pf-blur-${uid}`} filterUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
                  <feGaussianBlur stdDeviation="4" />
                </filter>
              </defs>

              {geometry.scale.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="rgba(148, 163, 184, 0.075)" strokeWidth="1" />
                  <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" className="fill-gray-500 tabular-nums" fontSize="10">
                    {compactBRL(tick)}
                  </text>
                </g>
              ))}

              {months.map((m, i) =>
                i % labelEvery === 0 ? (
                  <text key={m.key} x={x(i)} y={height - 8} textAnchor="middle" className="fill-gray-500" fontSize="10">
                    {formatMonthShort(m.key)}
                  </text>
                ) : null
              )}

              {geometry.area && <path d={geometry.area} fill={`url(#pf-area-${uid})`} stroke="none" />}
              <path
                d={geometry.path}
                fill="none"
                stroke={PORTFOLIO_COLOR}
                strokeWidth={stroke + 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#pf-blur-${uid})`}
                opacity={active !== null ? 0.24 : 0.1}
                aria-hidden="true"
              />
              <path d={geometry.path} data-portfolio-line="" fill="none" stroke={PORTFOLIO_COLOR} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />

              {geometry.isolated.map((p) => (
                <circle key={`iso-${p.x}`} data-isolated-point="" cx={p.x} cy={p.y} r="3.5" fill={PORTFOLIO_COLOR} />
              ))}

              {activeMonth && active !== null && (
                <g aria-hidden="true">
                  <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgba(206,218,234,0.26)" strokeDasharray="2 4" strokeWidth="1" />
                  {activeMonth.balance !== null && (
                    <>
                      <circle cx={x(active)} cy={y(activeMonth.balance)} r="9" fill={PORTFOLIO_COLOR} opacity="0.28" filter={`url(#pf-blur-${uid})`} />
                      <circle cx={x(active)} cy={y(activeMonth.balance)} r="4" fill={SURFACE} stroke={PORTFOLIO_COLOR} strokeWidth="2" />
                    </>
                  )}
                </g>
              )}

              {months.map((m, i) => {
                const slot = n === 1 ? innerW : innerW / (n - 1);
                return (
                  <rect
                    key={m.key}
                    ref={(el) => { slotRefs.current[i] = el; }}
                    x={x(i) - slot / 2}
                    y={PAD.top}
                    width={slot}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={describeMonth(m)}
                    className="cursor-pointer outline-none focus-visible:stroke-white/40"
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    onClick={() => setActive((cur) => (cur === i ? null : i))}
                    onKeyDown={(e) => onKeyDown(e, i)}
                  />
                );
              })}
            </svg>

            {activeMonth && (
              <div
                role="status"
                className="pointer-events-none absolute top-3 z-10 rounded-xl border p-3 text-xs backdrop-blur-[10px]"
                style={{
                  left: tooltipLeft,
                  width: TOOLTIP_WIDTH,
                  borderColor: 'rgba(113,137,166,0.30)',
                  background: 'linear-gradient(145deg, rgba(26,38,55,.98), rgba(11,18,29,.99))',
                  boxShadow: '0 18px 42px rgba(0,0,0,.44), inset 0 1px 0 rgba(255,255,255,.035)',
                }}
              >
                <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white">{formatMonthLabel(activeMonth.key)}</p>
                {activeMonth.balance === null ? (
                  <p className="text-gray-500">{NO_POSITION_LABEL}</p>
                ) : (
                  <>
                    <p className="font-semibold tabular-nums text-gray-100">{formatCurrency(activeMonth.balance)}</p>
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      {activeMonth.positionCount} {activeMonth.positionCount === 1 ? 'posição' : 'posições'} · saldo registrado
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <table className="sr-only">
            <caption>Saldo investido registrado por mês, últimos 12 meses</caption>
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col">Saldo registrado</th>
                <th scope="col">Posições</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.key}>
                  <th scope="row">{formatMonthLabel(m.key)}</th>
                  <td>{m.balance === null ? NO_POSITION_LABEL : formatCurrency(m.balance)}</td>
                  <td>{m.positionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
};

export default PortfolioHistoryChart;
