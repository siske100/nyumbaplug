import { Panel } from "./Panel";

export interface StatItem { label: string; value: string; note?: string; tone?: "warn" | "ok" }

export function Stats({ items, loading }: { items: StatItem[]; loading?: boolean }) {
  return (
    <Panel className="grid grid-cols-2 divide-white/8 lg:grid-cols-4 lg:divide-x">
      {loading
        ? [0, 1, 2, 3].map((i) => <div key={i} className="skeleton m-4 h-16" />)
        : items.map((s) => (
            <div key={s.label} className="min-w-0 p-3 sm:p-5">
              <p className="text-sm text-graphite-300">{s.label}</p>
              <p className={`mt-1 break-words font-display text-2xl sm:text-3xl ${s.tone === "warn" ? "text-ember-300" : s.tone === "ok" ? "text-ok" : ""}`}>{s.value}</p>
              {s.note && <p className="mt-0.5 break-words text-xs text-graphite-400 sm:text-sm">{s.note}</p>}
            </div>
          ))}
    </Panel>
  );
}
