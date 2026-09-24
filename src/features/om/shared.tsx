// Shared O&M vocabulary and the generation chart.
import { useState } from 'react';
import type { BadgeProps } from '@/components/ui/badge';
import type { EquipmentType, MaintenanceType, Priority, TaskStatus, TicketStatus } from '@/lib/types';
import { fmtDate, fmtNumber, safeNum } from '@/lib/format';

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: BadgeProps['variant'] }> = {
  open: { label: 'Open', tone: 'destructive' },
  assigned: { label: 'Assigned', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'secondary' },
};

export const PRIORITY: Record<Priority, { label: string; tone: BadgeProps['variant'] }> = {
  low: { label: 'Low', tone: 'secondary' },
  medium: { label: 'Medium', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  critical: { label: 'Critical', tone: 'destructive' },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: BadgeProps['variant'] }> = {
  todo: { label: 'Scheduled', tone: 'secondary' },
  in_progress: { label: 'In progress', tone: 'info' },
  blocked: { label: 'Blocked', tone: 'destructive' },
  done: { label: 'Done', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'secondary' },
};

export const EQUIPMENT_TYPES: EquipmentType[] = [
  'inverter', 'module', 'transformer', 'scb', 'acdb', 'dcdb', 'ups', 'meter', 'cctv', 'structure', 'other',
];
export const EQUIPMENT_LABEL: Record<EquipmentType, string> = {
  inverter: 'Inverter', module: 'Modules', transformer: 'Transformer', scb: 'SCB', acdb: 'ACDB', dcdb: 'DCDB',
  ups: 'UPS', meter: 'Energy meter', cctv: 'CCTV', structure: 'Structure', other: 'Other',
};
export const MAINTENANCE_TYPES: MaintenanceType[] = ['preventive', 'corrective', 'cleaning', 'inspection', 'calibration'];
export const TICKET_CATEGORIES = [
  'Inverter fault', 'Module damage', 'Grid outage', 'Cabling / connector', 'Transformer',
  'Module cleaning', 'Monitoring / communication', 'Security', 'Other',
];

/** kWh with the unit, never "NaN". */
export function fmtKwh(value: unknown, digits = 0): string {
  const n = safeNum(value);
  if (n >= 1_000_000) return `${fmtNumber(n / 1_000_000, 2)} GWh`;
  if (n >= 1000) return `${fmtNumber(n / 1000, 2)} MWh`;
  return `${fmtNumber(n, digits)} kWh`;
}

/**
 * Daily generation bars with an "expected" reference line.
 * One series, so no legend is needed — the title names it. Hovering a bar
 * shows the exact figures; the table below the chart is the data view.
 */
export function GenerationChart({ data, height = 220 }: { data: { date: string; kwh: number | string; expected: number | string | null }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const values = data.map((d) => safeNum(d.kwh));
  const expected = data.map((d) => (d.expected == null ? null : safeNum(d.expected)));
  const max = Math.max(...values, ...expected.map((e) => e ?? 0), 1);
  const width = 720;
  const padding = { top: 12, right: 8, bottom: 26, left: 48 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const step = plotW / data.length;
  const barW = Math.max(2, Math.min(28, step - 3)); // 2px+ gap between bars
  const y = (v: number) => padding.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const hasExpected = expected.some((e) => e !== null);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Daily generation in kWh">
        {/* recessive grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} x2={width - padding.right} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padding.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400" fontSize="10">
              {fmtNumber(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const v = safeNum(d.kwh);
          const h = Math.max(v > 0 ? 2 : 0, ((v / max) * plotH));
          const x = padding.left + i * step + (step - barW) / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padding.left + i * step} y={padding.top} width={step} height={plotH} fill="transparent" />
              <rect x={x} y={y(v)} width={barW} height={h} rx="4" fill={hover === i ? '#c25e07' : '#E8740C'} />
            </g>
          );
        })}

        {hasExpected && (
          <polyline
            points={data
              .map((_, i) => (expected[i] === null ? null : `${padding.left + i * step + step / 2},${y(expected[i] as number)}`))
              .filter(Boolean)
              .join(' ')}
            fill="none"
            stroke="#64748b"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        )}

        {/* first / last date labels only — no label on every point */}
        <text x={padding.left} y={height - 8} className="fill-slate-400" fontSize="10">
          {fmtDate(data[0].date)}
        </text>
        {data.length > 1 && (
          <text x={width - padding.right} y={height - 8} textAnchor="end" className="fill-slate-400" fontSize="10">
            {fmtDate(data[data.length - 1].date)}
          </text>
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((padding.left + hover * step + step / 2) / width) * 100}%`, top: 0 }}
        >
          <div className="font-medium">{fmtDate(data[hover].date)}</div>
          <div className="tabular mt-0.5">{fmtKwh(data[hover].kwh, 1)}</div>
          {expected[hover] !== null && <div className="tabular text-muted-foreground">Expected {fmtKwh(expected[hover], 1)}</div>}
        </div>
      )}
      {hasExpected && (
        <p className="mt-1 text-center text-xs text-muted-foreground">
          <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-500 align-middle" /> expected generation
        </p>
      )}
    </div>
  );
}
