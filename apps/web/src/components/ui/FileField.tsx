import { useId, type ChangeEvent } from "react";
import { CheckCircle2, FileUp } from "lucide-react";
import { cn } from "@/lib/cn";

export function FileField({ label, hint, file, error, onPick }: { label: string; hint?: string; file: File | null; error?: string; onPick: (f: File | null) => void }) {
  const id = useId();
  const change = (e: ChangeEvent<HTMLInputElement>) => onPick(e.target.files?.[0] ?? null);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-graphite-200">{label}</label>
      <label htmlFor={id} className={cn("flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed px-3.5 py-3 transition-colors hover:border-ember-400/70", error ? "border-danger/70" : file ? "border-ok/50" : "border-white/20")}>
        {file && !error ? <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden /> : <FileUp className="size-5 shrink-0 text-graphite-300" aria-hidden />}
        <span className="min-w-0 truncate text-sm">{file ? file.name : "Choose a JPG, PNG or PDF (max 5 MB)"}</span>
      </label>
      <input id={id} type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={change} aria-invalid={!!error} />
      {(error ?? hint) && <p role={error ? "alert" : undefined} className={cn("mt-1.5 text-sm", error ? "text-danger" : "text-graphite-300")}>{error ?? hint}</p>}
    </div>
  );
}
