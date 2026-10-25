import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { LedgerRow } from "@/api/types";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";
import { kenyanPhone } from "@rh/shared";

function Reverse({ row }: { row: LedgerRow }) {
  const rev = useLiveMutation("landlord", (reason: string) => api.landlord.reversePayment(row.id, reason));
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();
  if (row.kind === "reversal" || row.reversed) return null;
  if (!open) return <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Reverse</Button>;
  return (
    <div className="grid w-full gap-2 rounded-xl border border-white/10 bg-white/4 p-3">
      <p className="text-sm text-graphite-300">Payments are never edited. A reversal adds a new entry that cancels this one.</p>
      <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={err} />
      <ErrorNote error={rev.error} />
      <div className="flex gap-2"><Button size="sm" loading={rev.isPending} onClick={() => (reason.trim() ? rev.mutate(reason.trim(), { onSuccess: () => setOpen(false) }) : setErr("A reason is required"))}>Confirm reversal</Button><Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}

export default function Payments() {
  const { data, isPending, error } = useLive("landlord", "payments", () => api.landlord.payments());
  const tenants = useLive("landlord", "tenants", () => api.landlord.tenants());
  const resolve = useLiveMutation("landlord", (v: { held: string; tenancy: string }) => api.landlord.resolveHeld(v.held, v.tenancy));
  const dest = useLiveMutation("landlord", (v: { kind: "mpesa_phone" | "bank_paybill"; destination: string; accountRef: string | null }) => api.landlord.savePayoutDestination(v.kind, v.destination, v.accountRef));
  const [pick, setPick] = useState<Record<string, string>>({});
  const [d, setD] = useState({ kind: "mpesa_phone" as "mpesa_phone" | "bank_paybill", destination: "", accountRef: "" });
  const [dErr, setDErr] = useState<string>();
  const [showD, setShowD] = useState(false);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const month = (data?.ledger ?? []).filter((l) => new Date(l.at) >= monthStart).reduce((a, l) => a + (l.kind === "reversal" ? -l.amount : l.kind === "rent_payment" ? l.amount : 0), 0);

  const saveDest = () => {
    if (d.kind === "mpesa_phone") { const p = kenyanPhone.safeParse(d.destination); if (!p.success) return setDErr(p.error.issues[0]?.message); dest.mutate({ kind: d.kind, destination: p.data, accountRef: null }, { onSuccess: () => setShowD(false) }); }
    else { if (!/^\d{5,7}$/.test(d.destination)) return setDErr("Enter the bank's paybill number (5 to 7 digits)"); if (d.accountRef.trim().length < 3) return setDErr("Enter your account number at that bank"); dest.mutate({ kind: d.kind, destination: d.destination, accountRef: d.accountRef.trim() }, { onSuccess: () => setShowD(false) }); }
    setDErr(undefined);
  };

  return (
    <div className="grid gap-4">
      <PageHead title="Payments" sub="Every shilling, recorded. Entries are never edited: a mistake is fixed with a reversal." action={<Link to="/landlord/mpesa"><Button variant="glass" size="sm">M-Pesa setup</Button></Link>} />
      <ErrorNote error={error} />
      <Stats loading={isPending} items={[
        { label: "Received this month", value: formatKes(month), tone: "ok" }, { label: "Still owed", value: formatKes(data?.owed ?? 0), tone: (data?.owed ?? 0) > 0 ? "warn" : undefined },
        { label: "Rent goes to", value: data?.mode === "own" ? "Your Paybill" : "Platform", note: data?.mode === "own" ? "straight to you" : "paid out to you" }, { label: "Held payments", value: String(data?.held.length ?? 0), tone: data?.held.length ? "warn" : undefined },
      ]} />

      {data && data.held.length > 0 && (
        <Panel className="grid gap-3 p-5 sm:p-6">
          <h2 className="text-xl">Payments that need you</h2>
          <p className="text-sm text-graphite-300">These arrived but could not be matched safely (wrong amount). Assign each to the right tenant.</p>
          <ErrorNote error={resolve.error} />
          {data.held.map((h) => (
            <div key={h.id} className="grid items-end gap-3 rounded-xl border border-ember-500/30 bg-ember-500/8 p-3 sm:grid-cols-[1fr_1fr_auto]">
              <div><p className="font-medium">{formatKes(h.amount)}</p><p className="text-sm text-graphite-300">{fmtDate(h.at)} · {h.ref} · account {h.billRef}</p></div>
              <SelectField label="Assign to" value={pick[h.id] ?? ""} onChange={(e) => setPick({ ...pick, [h.id]: e.target.value })}><option value="">Choose a tenant</option>{tenants.data?.filter((t) => t.status !== "ended").map((t) => <option key={t.id} value={t.id}>{t.name} (unit {t.unit})</option>)}</SelectField>
              <Button size="sm" disabled={!pick[h.id]} loading={resolve.isPending} onClick={() => resolve.mutate({ held: h.id, tenancy: pick[h.id]! })}>Assign</Button>
            </div>
          ))}
        </Panel>
      )}

      {data?.mode === "platform" && (
        <Panel className="grid gap-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl">Where we pay you</h2>{!showD && <Button variant="glass" size="sm" onClick={() => setShowD(true)}>{data.destination ? "Change" : "Add"}</Button>}</div>
          {data.destination ? <p>{data.destination.kind === "mpesa_phone" ? `M-Pesa ${data.destination.destination}` : `Bank paybill ${data.destination.destination}, account ${data.destination.accountRef}`} {data.destination.verified ? <Chip tone="ok">Verified</Chip> : <Chip tone="ember">Waiting to be verified</Chip>}</p> : <p className="text-graphite-300">Add where to send your rent. Collected rent is paid out here.</p>}
          {showD && (
            <div className="grid gap-3">
              <SelectField label="Pay me by" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as typeof d.kind })}><option value="mpesa_phone">M-Pesa to my phone</option><option value="bank_paybill">Bank, through its paybill</option></SelectField>
              <Field label={d.kind === "mpesa_phone" ? "M-Pesa phone number" : "Bank paybill number"} value={d.destination} onChange={(e) => setD({ ...d, destination: e.target.value })} />
              {d.kind === "bank_paybill" && <Field label="Your account number at the bank" value={d.accountRef} onChange={(e) => setD({ ...d, accountRef: e.target.value })} />}
              {dErr && <p role="alert" className="text-sm text-danger">{dErr}</p>}<ErrorNote error={dest.error} />
              <div className="flex gap-2"><Button loading={dest.isPending} onClick={saveDest}>Save</Button><Button variant="ghost" onClick={() => setShowD(false)}>Cancel</Button></div>
            </div>
          )}
          {data.payouts.length > 0 && <ul className="divide-y divide-white/8">{data.payouts.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span>{fmtDate(p.at)} · {formatKes(p.amount)}</span><span className="flex items-center gap-2 text-sm text-graphite-300">{p.ref}<Chip tone={p.status === "paid" ? "ok" : "ember"}>{p.status}</Chip></span></li>)}</ul>}
        </Panel>
      )}

      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">Ledger</h2>
        {data?.ledger.length === 0 && <ToLet title="No payments yet" note="Rent appears here the moment a tenant pays." />}
        <ul className="mt-3 divide-y divide-white/8">
          {data?.ledger.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div><p className="font-medium">{l.tenantName} <span className="text-graphite-400">unit {l.unit}</span></p><p className="text-sm text-graphite-300">{fmtDate(l.at)} · {l.method === "stk_push" ? "M-Pesa prompt" : l.method === "c2b" ? "Paybill" : "Reversal"} · {l.ref}</p></div>
              <div className="flex flex-wrap items-center gap-2">{l.reversed && <Chip>Reversed</Chip>}{l.kind === "reversal" && <Chip tone="danger">Reversal</Chip>}<span className={l.kind === "reversal" ? "text-danger" : ""}>{l.kind === "reversal" ? "−" : ""}{formatKes(l.amount)}</span><Reverse row={l} /></div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
