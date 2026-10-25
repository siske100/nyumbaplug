// Picks how much visual effect a device can comfortably afford. Cheap phones and limited data get the light version.
export type Perf = "lite" | "standard" | "rich";
export interface DeviceSignals {
  memoryGb?: number;            // navigator.deviceMemory (rounded; absent on some browsers)
  cores?: number;               // navigator.hardwareConcurrency
  saveData?: boolean;           // the person turned on data saver
  reducedMotion?: boolean;
  reducedTransparency?: boolean;
  finePointer?: boolean;        // a mouse or trackpad, not a finger
  override?: Perf | null;       // a choice the person made themselves
}

export function choosePerf(s: DeviceSignals): Perf {
  if (s.override) return s.override;
  if (s.saveData || s.reducedMotion || s.reducedTransparency) return "lite";
  const weak = (s.memoryGb !== undefined && s.memoryGb <= 2) || (s.cores !== undefined && s.cores <= 2);
  if (weak) return "lite";
  const strong = (s.memoryGb === undefined || s.memoryGb >= 8) && (s.cores === undefined || s.cores >= 8) && s.finePointer === true;
  return strong ? "rich" : "standard";
}
