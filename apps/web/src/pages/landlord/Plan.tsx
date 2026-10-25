import { priceFormula } from "@rh/shared";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

export default function Plan() {
  const sub = useLive("landlord", "subscription", () => api.landlord.subscription(), { refetchInterval: 5_000 });
  const pay = useLiveMutation("landlord", () => api.landlord.pay("subscription", sub.data!.price));
  const d = sub.data;
  const waiting = d?.lastAttempt?.status === "pending" && Date.now() - new Date(d.lastAttempt.at).getTime() < 5 * 60_000;

  return (
    <div className="grid gap-4">
      <PageHead title="Plan" sub="Prepaid by M-Pesa. Your account stays active while the plan is paid." />
      <ErrorNote error={sub.error} />
      <Stats loading={sub.isPending} items={[
        { label: "This month", value: formatKes(d?.price ?? 0), note: d ? priceFormula(d.units) : "" },
        { label: "Days left", value: d?.daysLeft === null || d?.daysLeft === undefined ? "-" : String(Math.max(0, d.daysLeft)), tone: (d?.daysLeft ?? 99) <= 7 ? "warn" : undefined, note: d?.periodEnd ? `until ${fmtDate(d.periodEnd)}` : "" },
        { label: "Units", value: String(d?.units ?? 0), note: "20 included" }, { label: "Status", value: d?.state === "active" ? "Active" : d?.state ?? "" },
      ]} />
      <Panel tone="hero" className="grid gap-4 p-5 sm:p-6">
        <h2 className="text-2xl">Renew</h2>
        <p className="text-graphite-300">Renewing early adds 30 days to your end date. You pay {d ? formatKes(d.price) : "..."}: KES 1,000 covers 20 units, and each extra unit adds KES 15.</p>
        <ErrorNote error={pay.error} />
        {pay.data && <p role="status" className="text-sm text-ok">{pay.data.message} Your plan extends when M-Pesa confirms.</p>}
        {waiting && <p role="status" className="text-sm text-ember-300">Waiting for your M-Pesa confirmation...</p>}
        {d?.lastAttempt?.status === "failed" && !waiting && <p className="text-sm text-graphite-300">Your last payment did not go through. You were not charged.</p>}
        <div><Button magnetic loading={pay.isPending} disabled={!d} onClick={() => pay.mutate()}>Pay {d ? formatKes(d.price) : ""} with M-Pesa</Button></div>
        <p className="text-sm text-graphite-400">If your plan lapses, your houses are hidden and tenant logins pause. Call customer care on 0799326074 to reactivate.</p>
      </Panel>
      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">Payment history</h2>
        <ul className="mt-3 divide-y divide-white/8">
          {d?.payments.length === 0 && <li className="py-3 text-graphite-300">No payments yet.</li>}
          {d?.payments.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span>{fmtDate(p.at)} · M-Pesa {p.ref}</span><span className="flex items-center gap-2">{formatKes(p.amount)} <Chip tone="ok">paid</Chip></span></li>)}
        </ul>
      </Panel>
    </div>
  );
}
