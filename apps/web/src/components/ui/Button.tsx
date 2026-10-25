import { useRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "glass" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
  magnetic?: boolean;           // the button leans toward the cursor (mouse devices on strong hardware only)
};

const variants = {
  primary: "bg-ember-500 text-graphite-950 font-semibold shadow-[0_6px_24px_rgb(242_140_40/0.28)] hover:bg-ember-400",
  glass: "glass-quiet text-bone hover:bg-white/10",
  ghost: "text-graphite-200 hover:bg-white/8 hover:text-bone",
};

export function Button({ variant = "primary", size = "md", loading, magnetic, className, children, disabled, type = "button", onPointerMove, onPointerLeave, ...rest }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const lean = (e: React.PointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(e);
    const root = document.documentElement;
    if (!magnetic || root.dataset.perf !== "rich" || root.dataset.pointer !== "fine" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.transform = `translate(${((e.clientX - r.left) / r.width - 0.5) * 8}px, ${((e.clientY - r.top) / r.height - 0.5) * 6}px)`;
  };
  const rest0 = (e: React.PointerEvent<HTMLButtonElement>) => { onPointerLeave?.(e); if (ref.current) ref.current.style.transform = ""; };
  return (
    <button ref={ref} onPointerMove={lean} onPointerLeave={rest0}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[10px] transition-[colors,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-[0.95rem]",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
