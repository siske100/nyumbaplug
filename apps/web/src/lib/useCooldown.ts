import { useEffect, useState } from "react";

/** A countdown for "send again" buttons. */
export function useCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [until]);
  return {
    left: Math.max(0, Math.ceil((until - now) / 1000)),
    start: (seconds: number) => { const t = Date.now(); setNow(t); setUntil(t + seconds * 1000); },
  };
}
