import { useEffect, useRef } from "react";

/** Writes the pointer position to --mx and --my on an element. No React state, so moving the mouse never re-renders anything. */
export function useCursorField<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || root.dataset.perf === "lite" || root.dataset.pointer !== "fine") return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", String((e.clientX - r.left) / r.width));
        el.style.setProperty("--my", String((e.clientY - r.top) / r.height));
      });
    };
    el.addEventListener("pointermove", move);
    return () => { el.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return ref;
}
