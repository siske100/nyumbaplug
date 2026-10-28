import { CreditCard, FileCheck2, MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useAdminCelcom, useAdminKyc, useAdminLandlords, useAdminPayments } from "@/features/admin/hooks";
import { useSession } from "@/features/auth/useSession";
import { formatKes, plural } from "@/lib/format";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function AdminOverview() {
  const { data: session } = useSession();
  const landlords = useAdminLandlords(), kyc = useAdminKyc(), payments = useAdminPayments(), celcom = useAdminCelcom();
  const loading = landlords.isPending || payments.isPending || celcom.isPending;

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const received = (payments.data ?? []).filter((p) => new Date(p.paidAt) >= monthStart).reduce((a, p) => a + p.amount, 0);
  const due = (landlords.data ?? []).filter((l) => (l.state === "active" || l.state === "expired") && l.daysLeft !== null && l.daysLeft <= 7);
  const dueSum = due.reduce((a, l) => a + l.monthlyPrice, 0);
  const suspended = (landlords.data ?? []).filter((l) => l.state === "suspended").length;
  const todo = [
    { show: (kyc.data?.length ?? 0) > 0, to: "/admin/documents", icon: FileCheck2, title: `${plural(kyc.data?.length ?? 0, "landlord")} waiting for approval`, note: "Review their ID and KRA documents." },
    { show: due.length > 0, to: "/admin/subscriptions", icon: CreditCard, title: `${plural(due.length, "subscription")} due within 7 days or overdue`, note: `${formatKes(dueSum)} to collect. Send reminders.`, urgent: true },
    { show: celcom.data?.low === true, to: "/admin/celcom", icon: MessageSquare, title: "Celcom credit is low", note: "Top up before verification codes stop.", urgent: true },
  ].filter((t) => t.show);

  return (
    <div className="grid gap-4">
      <Panel tone="hero" className="p-6 sm:p-8">
        <h1 className="text-3xl sm:text-4xl">{greeting()}, <em className="font-display not-italic text-ember-400">{session?.name}</em></h1>
        <p className="mt-2 text-graphite-200">{formatKes(received)} received this month from {plural((landlords.data ?? []).filter((l) => l.state === "active").length, "active landlord")}.</p>
      </Panel>
      <ErrorNote error={landlords.error ?? payments.error ?? celcom.error} />
      <Stats loading={loading} items={[
        { label: "Received this month", value: formatKes(received) },
        { label: "Due within 7 days", value: formatKes(dueSum), note: plural(due.length, "landlord"), tone: due.length ? "warn" : undefined },
        { label: "Celcom credit (estimate)", value: formatKes(Math.round(celcom.data?.balance ?? 0)), note: celcom.data?.low ? "Low, top up" : "Healthy", tone: celcom.data?.low ? "warn" : "ok" },
        { label: "Suspended", value: String(suspended), note: "accounts" },
      ]} />
      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">What needs you</h2>
        <ul className="mt-4 grid gap-2.5">
          {todo.length === 0 && <li className="text-graphite-300">All clear. Nothing needs you right now.</li>}
          {todo.map((t) => (
            <li key={t.to}>
              <Link to={t.to} className={`flex gap-3 rounded-xl border p-3.5 hover:bg-white/5 ${t.urgent ? "border-danger/35 bg-danger/8" : "border-white/8 bg-white/4"}`}>
                <t.icon className="mt-0.5 size-5 shrink-0 text-ember-400" aria-hidden />
                <div><p className="font-medium">{t.title}</p><p className="text-sm text-graphite-300">{t.note}</p></div>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
