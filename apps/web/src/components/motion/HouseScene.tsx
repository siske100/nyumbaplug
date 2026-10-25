import { cn } from "@/lib/cn";

// Three small houses. Each lit window stands for one vacant unit, so the picture carries real data.
const HOUSES = [
  { x: 20, w: 150, h: 96, windows: [[20, 14], [58, 14], [96, 14], [20, 48], [58, 48]] },
  { x: 210, w: 190, h: 128, windows: [[26, 14], [66, 14], [106, 14], [146, 14], [26, 54], [66, 54], [106, 54], [146, 54]] },
  { x: 450, w: 130, h: 80, windows: [[20, 14], [58, 14], [96, 14]] },
];

export function HouseScene({ vacant, className }: { vacant: number; className?: string }) {
  let n = 0;
  const total = HOUSES.reduce((a, h) => a + h.windows.length, 0);
  const lit = Math.max(0, Math.min(total, vacant));
  return (
    <svg viewBox="0 0 600 200" role="img" aria-label={`Illustration of houses. ${lit} windows are lit, one for each vacant unit.`} className={cn("w-full", className)}>
      <g className="px-1" opacity="0.5">
        <polyline points="0,150 60,120 120,150 200,100 280,150 360,110 440,150 520,118 600,150" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
      </g>
      <g className="px-2">
        {HOUSES.map((h, i) => {
          const top = 170 - h.h;
          return (
            <g key={i}>
              <rect x={h.x} y={top} width={h.w} height={h.h} rx="6" fill="rgb(255 255 255 / 0.05)" stroke="rgb(255 255 255 / 0.18)" />
              <polygon points={`${h.x - 8},${top} ${h.x + h.w / 2},${top - 34} ${h.x + h.w + 8},${top}`} fill="rgb(255 255 255 / 0.07)" stroke="rgb(255 255 255 / 0.18)" />
              {h.windows.map(([dx, dy], k) => {
                const index = n++;
                return <rect key={k} x={h.x + dx!} y={top + dy!} width="22" height="22" rx="4" className={cn("win", index < lit && "lit")} style={{ ["--i" as string]: index }} />;
              })}
              <rect x={h.x + h.w / 2 - 10} y="146" width="20" height="24" rx="3" fill="rgb(255 255 255 / 0.12)" />
            </g>
          );
        })}
      </g>
      <g className="px-3"><line x1="0" y1="171" x2="600" y2="171" stroke="rgb(255 255 255 / 0.2)" strokeWidth="2" /></g>
    </svg>
  );
}

/** A row of small windows: lit ones are vacant units. */
export function Windows({ total, vacant, max = 14 }: { total: number; vacant: number; max?: number }) {
  const shown = Math.min(total, max);
  const lit = total > max ? Math.round((vacant / total) * shown) : vacant;
  return (
    <svg viewBox={`0 0 ${shown * 16} 14`} className="h-3.5" style={{ width: shown * 16 }} aria-hidden>
      {Array.from({ length: shown }, (_, i) => <rect key={i} x={i * 16} y="0" width="12" height="14" rx="3" className={cn("win", i < lit && "lit")} style={{ ["--i" as string]: 0 }} />)}
    </svg>
  );
}
