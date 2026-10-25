import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { HouseLoader, PayCelebration } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useSession } from "@/features/auth/useSession";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function Pay() {
  const { data: session } = useSession();
  const [waiting, setWaiting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const before = useRef<number | null>(null);
  const home = useLive("tenant", "home", () => api.tenant.home(), { refetchInterval: waiting ? 4000 : false });
  const pay = useLiveMutation<void, { message: string; amount: number }>("tenant", () => api.tenant.pay());
  const [copied, setCopied] = useState<string>();
  const h = home.data;

  useEffect(() => {
    if (!waiting) return;
    const stop = setTimeout(() => setWaiting(false), 3 * 60_000);
    return () => clearTimeout(stop);
  }, [waiting]);
  useEffect(() => {
    if (waiting && h && before.current !== null && before.current > 0 && h.balance === 0) { setWaiting(false); setCelebrate(true); }
    if (waiting && h?.lastAttempt?.status === "failed") setWaiting(false);
  }, [h, waiting]);

  if (home.isPending) return <HouseLoader />;
  if (!h) return <Panel className="p-8 text-center"><p className="text-lg">We could not find your tenancy.</p><p className="mt-1 text-graphite-300">Ask your landlord to check your details.</p></Panel>;
  const t = h.tenancy;
  const copy = (key: string, v: string) => { void navigator.clipboard.writeText(v); setCopied(key); };

  return (
    <div className="grid gap-4">
      <Panel tone="hero" className="p-6 sm:p-8">
        <h1 className="text-3xl sm:text-4xl">{greeting()}, <em className="font-display not-italic text-ember-400">{session?.name?.split(" ")[0]}</em></h1>
        <p className="mt-2 text-graphite-200">{t.houseTitle}, unit {t.unit}. Rent {formatKes(t.rent)} is due on the {t.dueDay}th.</p>
      </Panel>
      <ErrorNote error={home.error} />
      <Stats items={[
        { label: "Balance", value: formatKes(h.balance), tone: h.balance > 0 ? "warn" : "ok", note: h.balance > 0 ? "due now" : "paid up" },
        { label: "Next due", value: `${t.dueDay}th`, note: "every month" }, { label: "Paid so far", value: formatKes(h.paid) }, { label: "Payments", value: String(h.history.length) },
      ]} />

      <Panel className="grid gap-4 p-5 sm:p-6">
        {celebrate ? <PayCelebration message="Payment received. Thank you!" /> : h.balance > 0 ? (
          <>
            <h2 className="text-2xl">Pay rent</h2>
            <p className="text-graphite-300">You pay the full balance of <span className="text-bone">{formatKes(h.balance)}</span>. You will get an M-Pesa prompt on your phone: enter your PIN to finish.</p>
            <ErrorNote error={pay.error} />
            {waiting && <p role="status" className="text-ember-300">Check your phone and enter your M-Pesa PIN. This page updates by itself.</p>}
            {!waiting && h.lastAttempt?.status === "failed" && <p className="text-sm text-graphite-300">Your last payment did not go through. You were not charged. Try again.</p>}
            <div><Button magnetic size="md" loading={pay.isPending} disabled={waiting} onClick={() => { before.current = h.balance; setCelebrate(false); pay.mutate(undefined, { onSuccess: () => setWaiting(true) }); }}>{waiting ? "Waiting for M-Pesa..." : `Pay ${formatKes(h.balance)} with M-Pesa`}</Button></div>
          </>
        ) : (
          <><h2 className="text-2xl">You are paid up</h2><p className="text-graphite-300">Nothing to pay right now. Your next rent of {formatKes(t.rent)} is due on the {t.dueDay}th.</p></>
        )}
      </Panel>

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
    </div>
  );
}
