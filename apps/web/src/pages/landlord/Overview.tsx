import { ArrowRight, BarChart3, Building2, CalendarDays, CircleDollarSign, Handshake, Plus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { LedgerRow, VisitItem } from "@/api/types";
import { DashboardTrend, type TrendPoint } from "@/components/ui/DashboardTrend";
import { ErrorNote } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { SupportForm } from "@/components/shared/SupportForm";
import { useSession } from "@/features/auth/useSession";
import { useLandlordHouses, useLandlordSummary } from "@/features/landlord/hooks";
import { useLive } from "@/features/live";
import { formatKes } from "@/lib/format";

function sixMonthRange(): (TrendPoint & { key: string })[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: new Intl.DateTimeFormat("en", { month: "short" }).format(date),
      bookings: 0,
      revenue: 0,
    };
  });
}

function monthKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function monthlyRevenue(ledger: LedgerRow[], key: string) {
  return ledger.reduce((sum, row) => {
    if (monthKey(row.at) !== key || row.bucket !== "rent") return sum;
    if (row.kind === "rent_payment") return sum + row.amount;
    if (row.kind === "reversal") return sum - row.amount;
    return sum;
  }, 0);
}

function visitStatus(visit: VisitItem) {
  if (visit.status === "new") return "New";
  if (visit.status === "scheduled" || visit.status === "rescheduled") return "Scheduled";
  if (visit.status === "done") return "Completed";
  if (visit.status === "cancelled") return "Cancelled";
  return "In progress";
}

export default function Overview() {
  const { data: session } = useSession();
  const summary = useLandlordSummary();
  const houses = useLandlordHouses();
  const tenants = useLive("landlord", "dashboard-tenants", () => api.landlord.tenants());
  const visits = useLive("landlord", "visits", () => api.landlord.visits());
  const ledger = useLive("landlord", "dashboard-ledger", () => api.landlord.dashboardLedger());
  const points = sixMonthRange();
  const activeTenants = (tenants.data ?? []).filter((tenant) => tenant.status === "active").length;
  const thisMonthRevenue = ledger.data ? monthlyRevenue(ledger.data, monthKey(new Date().toISOString())) : 0;
  const monthBookings = (visits.data ?? []).filter((visit) => monthKey(visit.createdAt) === monthKey(new Date().toISOString())).length;
  for (const point of points) {
    point.bookings = (visits.data ?? []).filter((visit) => monthKey(visit.createdAt) === point.key).length;
    point.revenue = monthlyRevenue(ledger.data ?? [], point.key);
  }

  const recent = [...(visits.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  const errors = [summary.error, houses.error, tenants.error, visits.error, ledger.error].filter(Boolean);
  const metrics = [
    { label: "Total properties", value: houses.data ? String(houses.data.length) : "—", note: `${summary.data?.totalUnits ?? "—"} rental units`, icon: Building2, color: "dashboard-stat-rose", to: "/landlord/houses" },
    { label: "Total bookings", value: visits.data ? String(visits.data.length) : "—", note: `${monthBookings} this month`, icon: CalendarDays, color: "dashboard-stat-green", to: "/landlord/visits" },
    { label: "Active tenants", value: tenants.data ? String(activeTenants) : "—", note: "Current tenancies", icon: Users, color: "dashboard-stat-blue", to: "/landlord/tenants" },
    { label: "Rent this month", value: ledger.data ? formatKes(thisMonthRevenue) : "—", note: "Confirmed rent received", icon: CircleDollarSign, color: "dashboard-stat-orange", to: "/landlord/finances" },
  ];

  return (
    <div className="grid gap-3.5">
      {errors.map((error, index) => <ErrorNote key={index} error={error} />)}

      <section
        className="relative isolate flex min-h-40 flex-col justify-end overflow-hidden rounded-2xl bg-rose-950 px-4 py-5 text-white shadow-sm sm:min-h-48 sm:px-7 sm:py-7"
        style={{
          backgroundImage: "linear-gradient(90deg, rgb(91 0 29 / 0.94) 0%, rgb(91 0 29 / 0.78) 44%, rgb(91 0 29 / 0.16) 100%), linear-gradient(0deg, rgb(15 23 42 / 0.25), transparent 70%), url('/apartment-building.jpg')",
          backgroundPosition: "center, center, center 56%",
          backgroundSize: "cover",
        }}
      >
        <p className="text-sm font-semibold text-white/85 sm:text-base">Welcome back{session?.name ? `, ${session.name}` : ""}</p>
        <h2 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl">Landlord dashboard</h2>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4">
        {metrics.map(({ label, value, note, icon: Icon, color, to }) => (
          <Link key={label} to={to} className="group min-w-0 rounded-2xl focus-visible:outline-offset-2">
            <Panel className={`dashboard-landlord-stat ${color} flex h-full min-w-0 items-center gap-2.5 p-2.5 transition-shadow group-hover:shadow-md sm:gap-3.5 sm:p-3.5`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/70 sm:size-11"><Icon className="size-5 sm:size-6" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-xl font-extrabold leading-tight text-slate-900 sm:text-2xl">{value}</span>
                <span className="mt-1 block text-xs font-semibold text-slate-800 sm:text-sm">{label}</span>
                <span className="mt-0.5 block truncate text-[10px] text-slate-600 sm:text-[11px]">{note}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-slate-700 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Panel>
          </Link>
        ))}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(14rem,0.82fr)]">
        <Panel className="p-3.5 sm:p-4">
          <DashboardTrend data={points} title="Property performance" range="Last 6 months" variant="landlord" />
        </Panel>
        <Panel className="grid content-start gap-2.5 p-3.5 sm:p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Quick actions</p><h2 className="mt-1 text-base font-bold text-bone">Manage your rentals</h2></div>
            <Handshake className="size-5 text-ember-500" aria-hidden />
          </div>
          {[
            { to: "/landlord/houses?new=1", title: "Add property", detail: "Create a rental listing", icon: Plus },
            { to: "/landlord/visits", title: "View bookings", detail: `${visits.data?.filter((visit) => visit.status === "new").length ?? "—"} new requests`, icon: CalendarDays },
            { to: "/landlord/tenants", title: "Manage tenants", detail: `${activeTenants} active tenancies`, icon: Users },
            { to: "/landlord/finances", title: "View reports", detail: "Rent and payment ledger", icon: BarChart3 },
          ].map(({ to, title, detail, icon: Icon }) => (
            <Link key={to} to={to} className="dashboard-landlord-action flex items-center gap-2.5 rounded-xl p-2.5 transition-colors">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-orange-50 text-ember-600"><Icon className="size-4" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800">{title}</span><span className="block truncate text-[10px] text-slate-500">{detail}</span></span>
              <ArrowRight className="size-3.5 text-slate-400" aria-hidden />
            </Link>
          ))}
        </Panel>
      </div>

      <Panel className="p-3.5 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Your portfolio</p><h2 className="mt-1 text-base font-bold text-bone">My properties</h2></div>
          <Link to="/landlord/houses" className="inline-flex items-center gap-1 text-xs font-bold text-ember-600 hover:underline">View all <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        {houses.isPending && <div className="skeleton h-32" />}
        {!houses.isPending && houses.data?.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No properties yet. Add a property to get started.</p>}
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {(houses.data ?? []).slice(0, 3).map((house, index) => (
            <Link key={house.id} to="/landlord/houses" className="dashboard-landlord-property grid grid-cols-[minmax(7rem,0.9fr)_minmax(0,1.1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-md sm:block">
              <div className="relative min-h-36 overflow-hidden bg-slate-100 sm:h-36 sm:min-h-0 lg:h-40">
                {house.coverPhoto ? <img src={house.coverPhoto} alt={house.title} loading="lazy" className="size-full object-cover" /> : <img src="/apartment-building.jpg" alt="" loading="lazy" className="size-full object-cover" />}
                <span className="absolute right-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">{house.vacant > 0 ? "Active" : "Full"}</span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-extrabold text-slate-900">{house.title}</p>
                <p className="mt-0.5 truncate text-[10px] text-slate-500">{house.town} · {house.county}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-extrabold text-rose-800">{formatKes(house.rent)}<span className="font-medium text-slate-500"> / month</span></p>
                  <span className="text-[10px] text-slate-500">{house.vacant}/{house.total} vacant</span>
                </div>
              </div>
              {index === 0 && <span className="sr-only">First listed property</span>}
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.7fr)_minmax(13rem,0.8fr)]">
        <Panel className="p-3.5 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-graphite-400">Latest activity</p><h2 className="mt-1 text-base font-bold text-bone">Recent bookings</h2></div>
            <Link to="/landlord/visits" className="inline-flex items-center gap-1 text-xs font-bold text-ember-600 hover:underline">View all <ArrowRight className="size-3.5" aria-hidden /></Link>
          </div>
          {visits.isPending && <div className="skeleton h-20" />}
          {!visits.isPending && recent.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">New viewing requests will appear here.</p>}
          {recent.length > 0 && <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-[11px]">
              <thead><tr className="border-b border-slate-100 text-slate-500"><th className="py-2 pr-3 font-semibold">Date</th><th className="py-2 pr-3 font-semibold">Property</th><th className="py-2 pr-3 font-semibold">Tenant</th><th className="py-2 font-semibold">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((visit) => (
                  <tr key={visit.id}>
                    <td className="py-2 pr-3 text-slate-600">{new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short" }).format(new Date(visit.createdAt))}</td>
                    <td className="max-w-40 truncate py-2 pr-3 font-semibold text-slate-800">{visit.houseTitle}</td>
                    <td className="max-w-36 truncate py-2 pr-3 text-slate-600">{visit.visitorName}</td>
                    <td className="py-2"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${visit.status === "scheduled" || visit.status === "rescheduled" ? "bg-emerald-100 text-emerald-700" : visit.status === "done" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-700"}`}>{visitStatus(visit)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </Panel>
        <Panel className="grid content-start gap-2.5 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-extrabold text-slate-900">Help & support</h2>
            <Link to="/landlord/support" className="shrink-0 text-xs font-bold text-rose-900 hover:underline">View replies</Link>
          </div>
          <p className="text-xs text-slate-600">Paste your issue here and the admin team will review it.</p>
          <SupportForm scope="landlord" />
        </Panel>
      </div>
    </div>
  );
}
