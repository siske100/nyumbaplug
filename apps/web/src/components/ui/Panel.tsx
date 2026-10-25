import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { useCursorField } from "@/components/motion/useCursorField";

/** hero: the one memorable panel per screen (it also carries the cursor light). default: working surfaces. quiet: lists inside panels. */
export function Panel({ tone = "default", className, ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: "hero" | "default" | "quiet" }) {
  const ref = useCursorField<HTMLDivElement>();
  return <div ref={tone === "hero" ? ref : undefined} className={cn(tone === "hero" ? "glass glass-hero cursor-field cursor-glow" : tone === "quiet" ? "glass-quiet" : "glass", className)} {...rest} />;
}
