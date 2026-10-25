import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useAdminLandlords, useAdminPayments, useSendReminder } from "@/features/admin/hooks";
import { formatKes } from "@/lib/format";
import { StatusChip } from "./Subscriptions";

export default function Payments() {
  const payments = useAdminPayments(), landlords = useAdminLandlords(), remind = useSendReminder();
  const [sent, setSent] = useState<string>();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const thisMonth = (payments.data ?? []).filter((p) => new Date(p.paidAt) >= monthStart);
  const due = (landlords.data ?? []).filter((l) => (l.state === "active" || l.state === "expired") && l.daysLeft !== null && l.daysLeft <= 7);

  return (
    <div className="grid gap-4">
      <PageHead title="Payments" sub="Subscription payments from landlords." />
      <ErrorNote error={payments.error ?? landlords.error} />
      <Stats loading={payments.isPending} items={[
        { label: "Received this month", value: formatKes(thisMonth.reduce((a, p) => a + p.amount, 0)), tone: "ok" },
        { label: "Payments this month", value: String(thisMonth.length) },
        { label: "Due within 7 days", value: formatKes(due.reduce((a, l) => a + l.monthlyPrice, 0)), tone: due.length ? "warn" : undefined },
        { label: "Landlords due", value: String(due.length) },
      ]} />
      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">Due within 7 days or overdue</h2>
        {sent && <p role="status" className="mt-2 text-sm text-ok">{sent}</p>}
        <ErrorNote error={remind.error} />
        <ul className="mt-3 divide-y divide-white/8">
          {due.length === 0 && <li className="py-3 text-graphite-300">Nobody is due.</li>}
          {due.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="font-medium">{l.name}</p><p className="text-sm text-graphite-300">{formatKes(l.monthlyPrice)}</p></div>
              <div className="flex items-center gap-2"><StatusChip l={l} /><Button variant="glass" size="sm" disabled={remind.isPending || !l.phone} onClick={() => remind.mutate(l.id, { onSuccess: () => setSent(`Reminder sent to ${l.name}.`) })}>Send reminder</Button></div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">Recent payments</h2>
        <ul className="mt-3 divide-y divide-white/8">
          {payments.data?.length === 0 && <li className="py-3 text-graphite-300">No payments recorded yet.</li>}
          {payments.data?.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div><p className="font-medium">{p.landlordName}</p><p className="text-sm text-graphite-300">{new Date(p.paidAt).toLocaleDateString("en-KE")} · M-Pesa {p.ref}</p></div>
              <div className="flex items-center gap-2">{p.byAdmin && <Chip>Recorded by you</Chip>}<span className="font-medium">{formatKes(p.amount)}</span></div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
