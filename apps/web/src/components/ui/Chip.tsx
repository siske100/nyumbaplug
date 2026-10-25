import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-white/7 text-graphite-200 border-white/10",
  ember: "bg-ember-500/15 text-ember-300 border-ember-500/30",
  ok: "bg-ok/12 text-ok border-ok/30",
  danger: "bg-danger/12 text-danger border-danger/30",
};

export function Chip({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}
