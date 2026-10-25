import { useId, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 text-bone placeholder:text-graphite-400 " +
  "transition-colors focus:border-ember-400/70 focus:outline-none aria-[invalid=true]:border-danger/70";

type Common = { label: string; error?: string; hint?: string };

export function Field({ label, error, hint, className, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm text-graphite-200">{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={note ? `${id}-note` : undefined} className={control} {...rest} />
      {note && <p id={`${id}-note`} role={error ? "alert" : undefined} className={cn("mt-1.5 text-sm", error ? "text-danger" : "text-graphite-300")}>{note}</p>}
    </div>
  );
}

export function SelectField({ label, error, hint, className, children, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm text-graphite-200">{label}</label>
      <select id={id} aria-invalid={!!error} className={cn(control, "appearance-none")} {...rest}>{children}</select>
      {note && <p role={error ? "alert" : undefined} className={cn("mt-1.5 text-sm", error ? "text-danger" : "text-graphite-300")}>{note}</p>}
    </div>
  );
}
