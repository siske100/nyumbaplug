import { CreditCard } from "lucide-react";
import { useState } from "react";
import { api } from "@/api";
import type { LedgerRow } from "@/api/types";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { Chip } from "@/components/ui/Chip";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

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

export default function Payments({ embedded = false }: { embedded?: boolean }) {
  const { data, isPending, error } = useLive("landlord", "payments", () => api.landlord.payments());
  const tenants = useLive("landlord", "tenants", () => api.landlord.tenants());
  const resolve = useLiveMutation("landlord", (v: { held: string; tenancy: string }) => api.landlord.resolveHeld(v.held, v.tenancy));
  const reviewManual = useLiveMutation("landlord", (v: { claimId: string; received: boolean }) =>
    api.landlord.reviewManualRentPayment(v.claimId, v.received));
  const [pick, setPick] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<{ id: string; received: boolean } | null>(null);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const month = (data?.ledger ?? []).filter((l) => new Date(l.at) >= monthStart).reduce((a, l) => a + (l.kind === "reversal" ? -l.amount : l.kind === "rent_payment" ? l.amount : 0), 0);

  return (
    <div id="ledger" className="grid gap-4">
      {!embedded && <PageHead title="Payments" sub="Every shilling, recorded. Entries are never edited: a mistake is fixed with a reversal." />}
      <ErrorNote error={error} />
      <div className="landlord-payment-summary">
      <Stats loading={isPending} items={[
        { label: "Received this month", value: formatKes(month), tone: "ok" }, { label: "Still owed", value: formatKes(data?.owed ?? 0), tone: (data?.owed ?? 0) > 0 ? "warn" : undefined },
        { label: "Rent collection", value: data?.mode === "bank_paybill" ? "Manual bank transfer" : data?.mode === "own" ? "Safaricom Daraja" : "Platform M-Pesa", note: data?.mode === "bank_paybill" ? "you confirm each bank transfer" : data?.mode === "own" ? "tenants pay directly to your Paybill" : "admin-reviewed landlord payouts" }, { label: "Held payments", value: String(data?.held.length ?? 0), tone: data?.held.length ? "warn" : undefined },
      ]} />
      </div>

      {data && data.manualClaims.length > 0 && (
        <Panel className="grid gap-3 p-5 sm:p-6">
          <h2 className="text-xl">Manual bank transfer claims</h2>
          <p className="text-sm text-graphite-300">A pasted transaction message is an unverified claim. Check your bank account independently; only mark received after confirming the funds arrived.</p>
          <ErrorNote error={reviewManual.error} />
          {data.manualClaims.map((claim) => (
            <div key={claim.id} className="grid gap-3 rounded-xl border border-white/10 bg-white/4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{claim.tenantName} · unit {claim.unit} · {formatKes(claim.amount)}</p>
                <Chip tone={claim.status === "received" ? "ok" : claim.status === "rejected" ? "danger" : "ember"}>{claim.status}</Chip>
              </div>
              <p className="text-sm text-graphite-400">Submitted {fmtDate(claim.submittedAt)}</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-graphite-950/60 p-3 text-sm text-graphite-200">{claim.transactionMessage}</pre>
              {claim.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={reviewManual.isPending} onClick={() => setReviewing({ id: claim.id, received: true })}>Mark received</Button>
                  <Button variant="ghost" size="sm" disabled={reviewManual.isPending} onClick={() => setReviewing({ id: claim.id, received: false })}>Reject claim</Button>
                </div>
              )}
              {reviewing?.id === claim.id && (
                <div className="grid gap-2 rounded-lg border border-ember-500/30 bg-ember-500/8 p-3">
                  <p className="text-sm">{reviewing.received
                    ? `Confirm that you independently verified ${formatKes(claim.amount)} reached your bank account. This will add it to the rent ledger.`
                    : "Reject this claim? It will not be added to the rent ledger."}</p>
                  <div className="flex gap-2">
                    <Button size="sm" loading={reviewManual.isPending} onClick={() => reviewManual.mutate(
                      { claimId: claim.id, received: reviewing.received },
                      { onSuccess: () => setReviewing(null) },
                    )}>{reviewing.received ? "Confirm funds received" : "Confirm rejection"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setReviewing(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </Panel>
      )}

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



      {data && data.payouts.length > 0 && (
        <Panel className="p-5 sm:p-6">
          <h2 className="text-xl">Platform payouts</h2>
          <p className="mt-1 text-sm text-graphite-300">Payouts requested from platform-collected rent are manually reviewed and processed by an admin.</p>
          <ul className="mt-3 divide-y divide-white/8">{data.payouts.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span>{fmtDate(p.at)} · {formatKes(p.amount)}</span><span className="flex items-center gap-2 text-sm text-graphite-300">{p.ref}<Chip tone={p.status === "paid" ? "ok" : "ember"}>{p.status}</Chip></span></li>)}</ul>
        </Panel>
      )}

      <Panel className="landlord-payment-ledger min-w-0 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-900"><CreditCard className="size-5" aria-hidden /></span>
          <div>
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Rent ledger</h2>
            <p className="text-xs text-slate-500">Confirmed receipts and adjustments</p>
          </div>
        </div>
        {data?.ledger.length === 0 && <ToLet title="No payments yet" note="Rent appears here after Safaricom confirms a payment or you confirm a manual bank transfer." />}
        <ul className="mt-3 divide-y divide-slate-100">
          {data?.ledger.map((l) => (
            <li key={l.id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{l.tenantName} <span className="text-slate-500">· unit {l.unit}</span></p>
                <p className="break-words text-xs leading-5 text-slate-500 sm:text-sm">{fmtDate(l.at)} · {l.method === "stk_push" ? "M-Pesa prompt" : l.method === "c2b" ? "Paybill" : l.method === "bank_paybill" ? "Bank Paybill (historical)" : l.method === "manual_transfer" ? "Manual bank transfer" : l.method === "paystack" ? "External checkout (historical)" : "Reversal"} · {l.ref}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">{l.reversed && <Chip>Reversed</Chip>}{l.kind === "reversal" && <Chip tone="danger">Reversal</Chip>}<span className={`font-bold ${l.kind === "reversal" ? "text-danger" : "text-slate-900"}`}>{l.kind === "reversal" ? "−" : ""}{formatKes(l.amount)}</span><Reverse row={l} /></div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
