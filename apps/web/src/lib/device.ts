import { useEffect, useState } from "react";
import { choosePerf, type DeviceSignals, type Perf } from "@rh/shared";

const KEY = "rh-perf";           // a harmless display preference, never anything about the person
type NavigatorExtras = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

function signals(): DeviceSignals {
  const n = navigator as NavigatorExtras;
  const stored = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  return {
    memoryGb: n.deviceMemory, cores: n.hardwareConcurrency, saveData: n.connection?.saveData === true,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, reducedTransparency: matchMedia("(prefers-reduced-transparency: reduce)").matches,
    finePointer: matchMedia("(hover: hover) and (pointer: fine)").matches,
    override: stored === "lite" || stored === "standard" || stored === "rich" ? stored : null,
  };
}

/** Sets <html data-perf> and <html data-pointer>. The stylesheet does the rest. */
export function applyDevice(): Perf {
  const s = signals();
  const perf = choosePerf(s);
  document.documentElement.dataset.perf = perf;
  document.documentElement.dataset.pointer = s.finePointer ? "fine" : "coarse";
  return perf;
}

export function setPerfOverride(p: Perf | null) {
  try { if (p) localStorage.setItem(KEY, p); else localStorage.removeItem(KEY); } catch { /* storage may be blocked */ }
  applyDevice();
}

export function usePerf(): Perf {
  const [perf, setPerf] = useState<Perf>(() => (document.documentElement.dataset.perf as Perf) ?? "standard");
  useEffect(() => {
    const obs = new MutationObserver(() => setPerf((document.documentElement.dataset.perf as Perf) ?? "standard"));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-perf"] });
    return () => obs.disconnect();
  }, []);
  return perf;
}
