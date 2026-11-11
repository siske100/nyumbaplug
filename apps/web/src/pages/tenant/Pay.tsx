import { useEffect, useRef, useState } from "react";
import { CalendarDays, CircleDollarSign, House, ReceiptText } from "lucide-react";
import { api } from "@/api";
import { HouseLoader, PayCelebration } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { SupportForm } from "@/components/shared/SupportForm";
import { useSession } from "@/features/auth/useSession";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function Pay() {
  const { data: session } = useSession();
  const [waiting, setWaiting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const before = useRef<{ attemptId: string | null } | null>(null);
  const home = useLive("tenant", "home", () => api.tenant.home(), { refetchInterval: waiting ? 4000 : false });
  const pay = useLiveMutation<number, { message: string; amount: number }>("tenant", (amount) => api.tenant.pay(amount));
  const manualPay = useLiveMutation("tenant", (v: { amount: number; message: string }) =>
    api.tenant.submitManualRentPayment(v.amount, v.message));
  const [copied, setCopied] = useState<string>();
  const [transferMessage, setTransferMessage] = useState("");
  const [paymentAmount, setPaymentAmount] = useState<string | null>(null);
  const [payInAdvance, setPayInAdvance] = useState(false);
  const h = home.data;
  const maxPayment = h ? Math.max(0, h.balance + 12 * h.tenancy.rent) : 0;

  useEffect(() => {
    if (h && paymentAmount === null) setPaymentAmount(String(Math.min(Math.max(h.balance, 1), maxPayment)));
  }, [h, paymentAmount, maxPayment]);

  useEffect(() => {
    if (!waiting || h?.paymentMode === "bank_paybill") return;
    const stop = setTimeout(() => setWaiting(false), 3 * 60_000);
    return () => clearTimeout(stop);
  }, [waiting, h?.paymentMode]);
  useEffect(() => {
    if (!waiting || !h) return;
    if (!before.current) return;
    const attempt = h.lastAttempt;
    if (!attempt || attempt.id === before.current.attemptId) return;
    if (attempt.status === "succeeded") {
      setWaiting(false);
      setCelebrate(true);
    } else if (attempt.status === "failed" || attempt.status === "timeout") {
      setWaiting(false);
    }
  }, [h, waiting]);

  if (home.isPending) return <HouseLoader />;
  if (!h) return <Panel className="p-8 text-center"><p className="text-lg">We could not find your tenancy.</p><p className="mt-1 text-graphite-300">Ask your landlord to check your details.</p></Panel>;
  const t = h.tenancy;
  const selectedAmount = Number(paymentAmount ?? "");
  const validPaymentAmount = Number.isInteger(selectedAmount) && selectedAmount > 0 && selectedAmount <= maxPayment;
  const copy = (key: string, v: string) => { void navigator.clipboard.writeText(v); setCopied(key); };

  return (
    <div className="grid gap-4">
      <Panel tone="hero" className="p-5 sm:p-7">
        <p className="text-sm font-semibold text-ember-600">Tenant dashboard</p>
        <h2 className="mt-2 text-3xl sm:text-4xl">{greeting()}, <em className="font-display not-italic text-ember-500">{session?.name?.split(" ")[0]}</em></h2>
        <p className="mt-2 text-graphite-300">{t.houseTitle}, unit {t.unit}. Rent {formatKes(t.rent)} is due on the {t.dueDay}th.</p>
      </Panel>
      <ErrorNote error={home.error} />
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {[
          { label: "Balance", value: formatKes(h.balance), note: h.balance > 0 ? "due now" : h.balance < 0 ? "rent credit" : "paid up", icon: CircleDollarSign, color: "bg-orange-100 text-orange-700" },
          { label: "Next due", value: `${t.dueDay}th`, note: "every month", icon: CalendarDays, color: "bg-violet-100 text-violet-700" },
          { label: "Paid so far", value: formatKes(h.paid), note: "confirmed rent payments", icon: CircleDollarSign, color: "bg-emerald-100 text-emerald-700" },
          { label: "Payments", value: String(h.history.length), note: "in your payment history", icon: ReceiptText, color: "bg-amber-100 text-amber-700" },
        ].map(({ label, value, note, icon: Icon, color }) => (
          <Panel key={label} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-graphite-300">{label}</p>
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${color}`}><Icon className="size-5" aria-hidden /></span>
            </div>
            <p className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">{value}</p>
            <p className="mt-1 text-xs text-graphite-400">{note}</p>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.75fr)]">
      <Panel className="grid content-start gap-4 p-5 sm:p-6">
        {celebrate ? <PayCelebration message="Payment received. Thank you!" /> : h.balance <= 0 && !payInAdvance ? (
          <>
            <h2 className="text-2xl">You are paid up</h2>
            <p className="text-graphite-300">
              {h.balance < 0
                ? `You have rent credit of ${formatKes(-h.balance)}. Your next rent of ${formatKes(t.rent)} is due on the ${t.dueDay}th.`
                : `Nothing to pay right now. Your next rent of ${formatKes(t.rent)} is due on the ${t.dueDay}th.`}
            </p>
            {h.paymentMode !== "unavailable" && (
              <Button variant="glass" size="sm" onClick={() => setPayInAdvance(true)}>Pay rent in advance</Button>
            )}
          </>
        ) : (
          <>
            <h2 className="text-2xl">Pay rent</h2>
            {h.paymentMode === "unavailable" ? <p role="status" className="text-graphite-300">Your landlord has not yet enabled a verified rent payment method. Please contact your landlord for payment instructions.</p> : <p className="text-graphite-300">
              Your balance is <span className="text-bone">{formatKes(h.balance)}</span>. Choose any amount to pay, including rent in advance for up to 12 months.
              {h.paymentMode === "bank_paybill"
                ? " Transfer the selected amount directly to your landlord's bank account. Your landlord must confirm receipt before it is added to your rent record."
                : " You will get an M-Pesa prompt on your phone: enter your PIN to finish."}
            </p>}
            <ErrorNote error={pay.error} />
            <ErrorNote error={manualPay.error} />
            {waiting && <p role="status" className="text-ember-300">Check your phone and enter your M-Pesa PIN. This page updates by itself.</p>}
            {!waiting && (h.lastAttempt?.status === "failed" || h.lastAttempt?.status === "timeout") && <p className="text-sm text-graphite-300">{h.lastAttempt.status === "timeout" ? "We could not confirm your last payment. Check your M-Pesa messages before trying again." : "Your last payment did not go through. You were not charged. Try again."}</p>}
            {h.paymentMode !== "unavailable" && <label className="grid gap-1.5 text-sm text-graphite-200">
              Amount to pay (KES)
              <input type="number" min={1} max={maxPayment} step={1} value={paymentAmount ?? ""}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 text-bone focus:border-ember-400/70 focus:outline-none" />
              <span className="text-xs text-graphite-400">Maximum now: {formatKes(maxPayment)} (balance plus up to 12 months of rent; pending payments may lower the limit).</span>
            </label>}
            {(h.paymentMode === "platform" || h.paymentMode === "own") && <Button magnetic size="md" loading={pay.isPending} disabled={waiting || !validPaymentAmount} onClick={() => { before.current = { attemptId: h.lastAttempt?.id ?? null }; setCelebrate(false); pay.mutate(selectedAmount, { onSuccess: () => setWaiting(true) }); }}>
              {waiting ? "Waiting for M-Pesa..." : `Pay ${validPaymentAmount ? formatKes(selectedAmount) : "rent"} with M-Pesa`}
            </Button>}
            {h.paymentMode === "bank_paybill" && h.manualBank && (
              <div className="grid gap-4">
                {([
                  ["Bank", h.manualBank.bankName, "manual-bank"],
                  ["Account holder", h.manualBank.accountName, "manual-holder"],
                  ["Account number", h.manualBank.accountNumber, "manual-account"],
                ] as const).map(([label, value, key]) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/4 px-4 py-3">
                    <div><p className="text-sm text-graphite-300">{label}</p><p className="font-display text-lg tracking-wide">{value}</p></div>
                    <Button variant="glass" size="sm" onClick={() => copy(key, value)}>{copied === key ? "Copied" : "Copy"}</Button>
                  </div>
                ))}
                {h.manualClaims.some((claim) => claim.status === "pending") ? (
                  <p role="status" className="rounded-lg border border-ember-500/30 bg-ember-500/8 p-3 text-sm text-graphite-200">
                    Your transfer claim is awaiting landlord review. It is not counted toward rent until your landlord confirms the money arrived.
                  </p>
                ) : (
                  <>
                    <label className="grid gap-1.5 text-sm text-graphite-200">
                      Transfer amount: {formatKes(validPaymentAmount ? selectedAmount : 0)}
                      Paste the bank transfer confirmation message
                      <textarea rows={4} maxLength={2000} value={transferMessage} onChange={(e) => setTransferMessage(e.target.value)}
                        placeholder="Paste the full transfer confirmation message here."
                        className="w-full rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 text-bone placeholder:text-graphite-400 focus:border-ember-400/70 focus:outline-none" />
                      <span className="text-xs text-graphite-400">This message is only your claim; it is not automatic proof of payment.</span>
                    </label>
                    <Button loading={manualPay.isPending} disabled={transferMessage.trim().length < 10 || !validPaymentAmount}
                      onClick={() => manualPay.mutate({ amount: selectedAmount, message: transferMessage.trim() }, { onSuccess: () => setTransferMessage("") })}>
                      Submit transfer for landlord review
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Panel>
      <Panel className="grid content-start gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-orange-100 text-orange-700"><House className="size-5" aria-hidden /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Your home</p><h2 className="text-lg font-bold text-bone">{t.houseTitle}</h2></div>
        </div>
        <dl className="grid gap-3">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><dt className="text-sm text-graphite-400">Unit</dt><dd className="text-sm font-semibold text-slate-800">{t.unit}</dd></div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><dt className="text-sm text-graphite-400">Monthly rent</dt><dd className="text-sm font-semibold text-slate-800">{formatKes(t.rent)}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-sm text-graphite-400">Rent due</dt><dd className="text-sm font-semibold text-slate-800">Every {t.dueDay}th</dd></div>
        </dl>
        <div className={`rounded-xl p-3 text-sm ${h.balance > 0 ? "bg-orange-50 text-orange-800" : "bg-emerald-50 text-emerald-800"}`}>
          {h.balance > 0 ? `${formatKes(h.balance)} rent balance is due.` : h.balance < 0 ? `${formatKes(-h.balance)} rent credit available.` : "Your rent is fully paid."}
        </div>
      </Panel>
      </div>

      {h.manualClaims.length > 0 && (
        <Panel className="p-5 sm:p-6">
          <h2 className="text-xl">Manual transfer claims</h2>
          <ul className="mt-3 divide-y divide-white/8">
            {h.manualClaims.map((claim) => (
              <li key={claim.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>{formatKes(claim.amount)} · {fmtDate(claim.submittedAt)}</span>
                <Chip tone={claim.status === "received" ? "ok" : claim.status === "rejected" ? "danger" : "neutral"}>
                  {claim.status === "received" ? "Landlord confirmed received" : claim.status === "rejected" ? "Rejected — contact your landlord" : "Awaiting landlord review"}
                </Chip>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {t.electricityEnabled && t.kplcPaybill && t.meterNumber && (
        <Panel className="grid gap-3 p-5 sm:p-6">
          <h2 className="text-xl">Electricity tokens</h2>
          <p className="text-sm text-graphite-300">In your M-Pesa app: Lipa na M-Pesa, Pay Bill, then enter these. Token payments go straight to KPLC and are not part of your rent record.</p>
          {([["Paybill number", t.kplcPaybill, "pb"], ["Account number (your meter)", t.meterNumber, "mn"]] as const).map(([label, v, k]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/4 px-4 py-3"><div><p className="text-sm text-graphite-300">{label}</p><p className="font-display text-xl tracking-wide">{v}</p></div><Button variant="glass" size="sm" onClick={() => copy(k, v)}>{copied === k ? "Copied" : "Copy"}</Button></div>
          ))}
        </Panel>
      )}

      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">Payment history</h2>
        <ul className="mt-3 divide-y divide-white/8">
          {h.history.length === 0 && <li className="py-3 text-graphite-300">No payments yet.</li>}
          {h.history.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p>{fmtDate(p.at)}</p><p className="text-sm text-graphite-400">Receipt {p.receipt}</p></div><div className="flex items-center gap-2">{p.kind === "reversal" && <Chip tone="danger">Reversed</Chip>}<span>{formatKes(p.amount)}</span></div></li>)}
        </ul>
      </Panel>

      <Panel className="grid gap-3 p-5 sm:p-6">
        <div><h2 className="text-xl font-bold text-slate-900">Help & support</h2><p className="mt-1 text-sm text-slate-600">Paste your issue here and the admin team will review it.</p></div>
        <SupportForm scope="tenant" />
      </Panel>
    </div>
  );
}
