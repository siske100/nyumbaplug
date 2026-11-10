import { formatKes } from "@/lib/format";

export interface TrendPoint {
  label: string;
  bookings: number;
  revenue: number;
}

function pointsFor(values: number[], max: number) {
  const left = 64, right = 610, top = 24, bottom = 178;
  const span = Math.max(1, values.length - 1);
  return values.map((value, index) => {
    const x = left + ((right - left) * index) / span;
    const y = bottom - (Math.max(0, value) / max) * (bottom - top);
    return `${x},${y}`;
  }).join(" ");
}

function currencyTick(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

export function DashboardTrend({ data, title = "Bookings and revenue", range = "Last 6 months", variant = "default" }: { data: TrendPoint[]; title?: string; range?: string; variant?: "default" | "landlord" }) {
  const bookingsColor = variant === "landlord" ? "#169b52" : "#1fbf69";
  const revenueColor = "#06492c";
  const revenueAxisMax = Math.max(0, ...data.map((item) => item.revenue));
  const bookingsAxisMax = Math.max(0, ...data.map((item) => item.bookings));
  const revenueLine = pointsFor(data.map((item) => item.revenue), revenueAxisMax || 1);
  const bookingsLine = pointsFor(data.map((item) => item.bookings), bookingsAxisMax || 1);
  const labelIndices = data.length <= 6
    ? data.map((_point, pointIndex) => pointIndex)
    : Array.from({ length: 5 }, (_, labelIndex) => Math.round((data.length - 1) * labelIndex / 4));

  return (
    <div role="img" aria-label={`${title}, monthly bookings and revenue over the last six months`} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">{range}</p>
          <h2 className="mt-1 text-lg font-bold text-bone">{title}</h2>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-graphite-300">
          <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ backgroundColor: bookingsColor }} />Bookings</span>
          <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ backgroundColor: revenueColor }} />Revenue (KES)</span>
        </div>
      </div>
      <div className="w-full overflow-hidden">
        <svg viewBox="0 0 660 225" className="h-auto w-full" aria-hidden="true">
          {[0, 1, 2, 3].map((line) => {
            const y = 178 - line * 51;
            const revenue = Math.round(revenueAxisMax * line / 3);
            const bookings = Math.round(bookingsAxisMax * line / 3);
            return <g key={line}>
              <line x1="64" x2="610" y1={y} y2={y} stroke="#e2e8f0" strokeDasharray={line === 0 ? undefined : "4 5"} />
              <text x="54" y={y + 4} textAnchor="end" fill="#64748b" fontSize="10">{currencyTick(revenue)}</text>
              <text x="620" y={y + 4} fill="#64748b" fontSize="10">{bookings}</text>
            </g>;
          })}
          <polyline points={revenueLine} fill="none" stroke={revenueColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={bookingsLine} fill="none" stroke={bookingsColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {data.map((item, index) => {
            const x = 64 + ((610 - 64) * index) / Math.max(1, data.length - 1);
            const revenueY = 178 - (Math.max(0, item.revenue) / (revenueAxisMax || 1)) * (178 - 24);
            const bookingY = 178 - (Math.max(0, item.bookings) / (bookingsAxisMax || 1)) * (178 - 24);
            return <g key={item.label}>
              <circle cx={x} cy={revenueY} r="3.5" fill={revenueColor} />
              <circle cx={x} cy={bookingY} r="3.5" fill={bookingsColor} />
              {labelIndices.includes(index) && <text x={x} y="203" textAnchor="middle" fill="#64748b" fontSize="10">{item.label}</text>}
            </g>;
          })}
        </svg>
      </div>
      <p className="sr-only">{data.map((item) => `${item.label}: ${item.bookings} bookings, ${formatKes(item.revenue)} revenue`).join(". ")}</p>
    </div>
  );
}
