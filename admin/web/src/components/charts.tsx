import { useMemo, useState } from 'react';
import { num } from '../format';

type Point = { date: string; value: number };

/** Dependency-free SVG area chart for daily series. */
export function AreaChart({
  series,
  height = 180,
  format = num,
  secondary,
  axisLabel = (d: string) => d.slice(5),
}: {
  series: Point[];
  height?: number;
  format?: (n: number) => string;
  secondary?: Point[];
  axisLabel?: (date: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  const max = useMemo(
    () => Math.max(1, ...series.map((p) => p.value), ...(secondary || []).map((p) => p.value)),
    [series, secondary],
  );
  if (!series.length) return <div className="muted small">No data</div>;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line(series)} L${x(series.length - 1)},${pad.top + innerH} L${x(0)},${pad.top + innerH} Z`;
  const h = hover != null ? series[hover] : null;

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * width;
          const i = Math.round(((rel - pad.left) / innerW) * (series.length - 1));
          setHover(Math.min(Math.max(i, 0), series.length - 1));
        }}
      >
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} className="chart-axis" />
        <path d={area} className="chart-area" />
        <path d={line(series)} className="chart-line" />
        {secondary?.length ? <path d={line(secondary)} className="chart-line chart-line-2" /> : null}
        {hover != null ? (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} className="chart-guide" />
            <circle cx={x(hover)} cy={y(series[hover].value)} r={4} className="chart-dot" />
          </>
        ) : null}
        <text x={pad.left} y={height - 6} className="chart-label">{axisLabel(series[0].date)}</text>
        <text x={width - pad.right} y={height - 6} textAnchor="end" className="chart-label">
          {axisLabel(series[series.length - 1].date)}
        </text>
      </svg>
      <div className="chart-readout small">
        {h ? (
          <>
            <strong>{format(h.value)}</strong>
            {secondary?.[hover!] ? <span className="muted"> / {format(secondary[hover!].value)}</span> : null}
            <span className="muted"> · {h.date}</span>
          </>
        ) : (
          <span className="muted">
            Total {format(series.reduce((a, p) => a + p.value, 0))} · peak {format(Math.max(0, ...series.map((p) => p.value)))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Horizontal bars for category breakdowns. */
export function BarList({ data, format = num, max: maxRows = 12 }: { data: Record<string, number> | { label: string; value: number }[]; format?: (n: number) => string; max?: number }) {
  const rows = (Array.isArray(data) ? data : Object.entries(data).map(([label, value]) => ({ label, value })))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, maxRows);
  if (!rows.length) return <div className="muted small">No data</div>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div key={r.label} className="barlist-row">
          <div className="barlist-label">{r.label.replace(/_/g, ' ')}</div>
          <div className="barlist-track">
            <div className="barlist-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          <div className="barlist-value">{format(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

/** Step funnel with conversion from the previous step. */
export function Funnel({ steps }: { steps: { key: string; label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="funnel">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].value : null;
        return (
          <div key={s.key} className="funnel-row">
            <div className="funnel-label">{s.label}</div>
            <div className="barlist-track">
              <div className="barlist-fill" style={{ width: `${Math.max(1.5, (s.value / max) * 100)}%` }} />
            </div>
            <div className="funnel-value">
              {num(s.value)}
              {prev ? <span className="muted small"> · {((s.value / prev) * 100).toFixed(0)}%</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
