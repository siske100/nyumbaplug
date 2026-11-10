import { ArrowRight, Building2, CalendarDays, CircleDollarSign, FileCheck2, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { DashboardTrend } from "@/components/ui/DashboardTrend";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { SupportForm } from "@/components/shared/SupportForm";
import { useAdminCelcom, useAdminKyc, useAdminLandlords, useAdminPayments } from "@/features/admin/hooks";
import { useLive } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

export default function AdminOverview() {
  const dashboard = useLive("admin", "dashboard-analytics", () => api.admin.dashboard());
  const support = useLive("admin", "support-preview", () => api.admin.supportRequests());
  const landlords = useAdminLandlords(), kyc = useAdminKyc(), payments = useAdminPayments(), celcom = useAdminCelcom();
  const summary = dashboard.data;
  const suspended = (landlords.data ?? []).filter((l) => l.state === "suspended").length;

  const metrics = [
    { label: "Total properties", value: summary ? summary.totalProperties.toLocaleString("en-KE") : "—", note: "Published on the platform", icon: Building2, color: "bg-emerald-100 text-emerald-700" },
    { label: "Monthly bookings", value: summary ? summary.monthlyBookings.toLocaleString("en-KE") : "—", note: "Viewing requests this month", icon: CalendarDays, color: "bg-violet-100 text-violet-700" },
    { label: "Total revenue", value: summary ? formatKes(summary.totalRevenue) : "—", note: "Subscriptions, SMS and platform fees", icon: CircleDollarSign, color: "bg-emerald-100 text-emerald-700" },
    { label: "Active marketers", value: summary ? summary.activeMarketers.toLocaleString("en-KE") : "—", note: "Activated accounts", icon: Users, color: "bg-amber-100 text-amber-700" },
  ];
  const recentActivity = [
    ...(payments.data ?? []).slice(0, 5).map((payment) => ({
      id: `payment-${payment.id}`, title: "Subscription payment recorded", detail: `${payment.landlordName} · ${formatKes(payment.amount)}`, at: payment.paidAt,
    })),
    ...(kyc.data ?? []).map((submission) => ({
      id: `verification-${submission.id}`, title: "Verification awaiting review", detail: submission.name, at: submission.createdAt,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);

  return (
    <div className="grid grid-cols-1 min-w-0 gap-4">
      <ErrorNote error={dashboard.error ?? landlords.error ?? payments.error ?? celcom.error ?? support.error} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ label, value, note, icon: Icon, color }, index) => (
          <Panel key={label} id={index === 0 ? "properties" : undefined} className="min-w-0 scroll-mt-24 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><p className="text-sm text-graphite-300">{label}</p><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${color}`}><Icon className="size-5" aria-hidden /></span></div>
            <p className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">{value}</p>
            <p className="mt-1 text-xs text-graphite-400">{note}</p>
          </Panel>
        ))}
      </div>

      <div id="reports" className="grid grid-cols-1 min-w-0 scroll-mt-24 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.8fr)]">
        <Panel className="min-w-0 p-4 sm:p-6">
          <DashboardTrend data={summary?.trend.map(({ month, ...point }) => ({ label: month, ...point })) ?? []} title="Bookings and platform revenue" range="Last 30 days" />
        </Panel>
        <Panel className="min-w-0 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Bookings by county</p>
          <h2 className="mt-1 text-lg font-bold text-bone">Top viewing locations</h2>
          <div className="mt-5 grid gap-4">
            {(summary?.counties ?? []).length === 0 && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">County booking activity will appear here.</p>}
            {(summary?.counties ?? []).map((county, index) => {
              const percent = county.share;
              return <div key={county.county}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span className="font-medium text-slate-700">{county.county}</span><span className="text-slate-500">{county.bookings} <span className="text-xs">({percent}%)</span></span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${index === 0 ? "bg-emerald-600" : "bg-emerald-300"}`} style={{ width: `${percent}%` }} /></div>
              </div>;
            })}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.8fr)]">
        <Panel className="grid min-w-0 content-start gap-2 p-4 sm:p-5">
          <div className="mb-1"><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Quick actions</p><h2 className="mt-1 text-lg font-bold text-bone">Manage platform</h2></div>
          {[
            { to: "/admin/documents", label: "Review verification", detail: `${kyc.data?.length ?? "—"} landlords pending`, icon: FileCheck2 },
            { to: "/admin#marketers", label: "View marketer activity", detail: `${summary?.activeMarketers ?? "—"} active accounts`, icon: Users },
            { to: "/admin/bookings", label: "Review bookings", detail: `${summary?.monthlyBookings ?? "—"} this month`, icon: CalendarDays },
            { to: "/admin#reports", label: "View reports", detail: "Bookings and county activity", icon: CircleDollarSign },
          ].map(({ to, label, detail, icon: Icon }) => <Link key={label} to={to} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 transition-colors hover:bg-emerald-50">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><Icon className="size-4" aria-hidden /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-800">{label}</span><span className="block text-xs text-slate-500">{detail}</span></span>
            <ArrowRight className="size-4 text-slate-400" aria-hidden />
          </Link>)}
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-500">
            <span>Suspended accounts <b className="text-slate-700">{suspended}</b></span>
            <span>Celcom balance <b className="text-slate-700">{celcom.data ? formatKes(celcom.data.balance) : "—"}</b></span>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 min-w-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(17rem,0.8fr)]">
        <Panel id="marketers" className="min-w-0 scroll-mt-24 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Marketplace performance</p><h2 className="mt-1 text-lg font-bold text-bone">Top Performing Marketers</h2></div><span className="text-xs text-slate-500">Top 5 by confirmed viewings</span></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Marketer</th><th className="py-2 pr-3">Listings</th><th className="py-2 pr-3">Viewings</th><th className="py-2">Earnings</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(summary?.topMarketers ?? []).map((marketer, index) => <tr key={marketer.id}>
                  <td className="py-3 pr-3 text-slate-400">{index + 1}</td><td className="py-3 pr-3 font-medium text-slate-700">{marketer.name}</td>
                  <td className="py-3 pr-3">{marketer.listings}</td><td className="py-3 pr-3">{marketer.bookings}</td><td className="py-3 font-semibold text-emerald-700">{formatKes(marketer.earnings)}</td>
                </tr>)}
                {(summary?.topMarketers ?? []).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-sm text-slate-500">No marketer performance to show yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel id="agents" className="min-w-0 scroll-mt-24 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Platform operations</p><h2 className="mt-1 text-lg font-bold text-bone">Recent Activities</h2></div><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Live</span></div>
          <ul className="grid gap-3">
            {recentActivity.map((item) => <li key={item.id} className="flex gap-3 border-l-2 border-emerald-200 pl-3">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="min-w-0"><span className="block text-sm font-semibold text-slate-800">{item.title}</span><span className="block truncate text-xs text-slate-500">{item.detail}</span><span className="block text-[11px] text-slate-400">{fmtDate(item.at)}</span></span>
            </li>)}
            {recentActivity.length === 0 && <li className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No recent platform activity.</li>}
          </ul>
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">Agent accounts are not enabled for this platform.</p>
        </Panel>
      </div>

      <Panel className="grid grid-cols-1 min-w-0 gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">User help requests</p><h2 className="mt-1 text-lg font-bold text-bone">Recent support issues</h2></div>
          <Link to="/admin/support" className="text-sm font-bold text-emerald-700 hover:underline">Open support inbox <ArrowRight className="inline size-4" aria-hidden /></Link>
        </div>
        {support.data?.filter((request) => request.status === "open").slice(0, 5).map((request) => (
          <div key={request.id} className="grid gap-1 border-t border-slate-100 pt-3">
            <p className="text-sm font-semibold text-slate-800">{request.name} <span className="font-normal text-slate-500">· {request.role} · {fmtDate(request.createdAt)}</span></p>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{request.message}</p>
          </div>
        ))}
        {support.data?.filter((request) => request.status === "open").length === 0 && <p className="text-sm text-slate-500">No open support issues.</p>}
        <div className="min-w-0 border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Submit an issue</h3>
          <SupportForm scope="admin" />
        </div>
      </Panel>

      <Panel id="settings" className="grid scroll-mt-24 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Platform</p><h2 className="mt-1 text-lg font-bold text-bone">Settings</h2><p className="mt-1 text-sm text-slate-500">Manage platform settings.</p></div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/celcom" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Settings</Link>
        </div>
      </Panel>
    </div>
  );
}
