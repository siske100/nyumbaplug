import { Field } from "./Field";

/** Six-digit code box. Digits only, and the phone's autofill for texted codes works. */
export function CodeField({ label, value, onChange, error, disabled }: { label: string; value: string; onChange: (v: string) => void; error?: string; disabled?: boolean }) {
  return (
    <Field
      label={label} value={value} error={error} disabled={disabled}
      inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      style={{ letterSpacing: "0.5em", fontSize: "1.35rem", textAlign: "center" }}
    />
  );
}
