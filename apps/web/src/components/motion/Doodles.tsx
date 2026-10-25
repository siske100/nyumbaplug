import { useEffect } from "react";
import { cn } from "@/lib/cn";

const OUTLINE = <><polyline points="10,52 60,14 110,52" /><rect x="22" y="52" width="76" height="54" rx="4" /><rect x="52" y="76" width="16" height="30" rx="2" /></>;

/** A house drawing itself. Used instead of a spinner. */
export function HouseLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="grid place-items-center gap-3 py-16 text-graphite-300">
      <svg viewBox="0 0 120 120" className="draw loop size-20" fill="none" stroke="var(--color-ember-400)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{OUTLINE}</svg>
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Shown when a payment lands: the house draws itself and phones give a short buzz. */
export function PayCelebration({ message }: { message: string }) {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.pointer === "coarse" && root.dataset.perf !== "lite") navigator.vibrate?.(30);
  }, []);
  return (
    <div role="status" className="grid place-items-center gap-3 py-6 text-center">
      <svg viewBox="0 0 120 120" className="draw size-24" fill="none" stroke="var(--color-ok)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{OUTLINE}<polyline points="44,84 56,96 80,66" /></svg>
      <p className="font-display text-xl">{message}</p>
    </div>
  );
}

/** A "to let" sign that swings, for lists with nothing in them yet. */
export function ToLet({ title, note, className }: { title: string; note?: string; className?: string }) {
  return (
    <div className={cn("grid place-items-center gap-3 py-10 text-center", className)}>
      <svg viewBox="0 0 120 90" className="size-24" aria-hidden>
        <line x1="20" y1="4" x2="20" y2="86" stroke="rgb(255 255 255 / 0.3)" strokeWidth="3" />
        <line x1="20" y1="10" x2="100" y2="10" stroke="rgb(255 255 255 / 0.3)" strokeWidth="3" />
        <g className="swing" style={{ transformOrigin: "60px 10px" }}>
          <line x1="40" y1="10" x2="40" y2="24" stroke="rgb(255 255 255 / 0.3)" /><line x1="86" y1="10" x2="86" y2="24" stroke="rgb(255 255 255 / 0.3)" />
          <rect x="26" y="24" width="74" height="40" rx="6" fill="rgb(242 140 40 / 0.18)" stroke="var(--color-ember-400)" />
          <text x="63" y="49" textAnchor="middle" fontSize="16" fontFamily="var(--font-display)" fill="var(--color-ember-300)">To let</text>
        </g>
      </svg>
      <p className="text-lg">{title}</p>
      {note && <p className="max-w-sm text-sm text-graphite-300">{note}</p>}
    </div>
  );
}
