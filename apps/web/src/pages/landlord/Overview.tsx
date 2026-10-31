import { AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, CircleDollarSign, Clock3, Home, Info, MessageSquareText, WalletCards } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { useSession } from "@/features/auth/useSession";
import { useLandlordSummary } from "@/features/landlord/hooks";
import { cn } from "@/lib/cn";
import { formatKes } from "@/lib/format";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default function Overview() {
  const { data: session } = useSession();
  const { data, isPending, isError } = useLandlordSummary();

  const occupiedUnits = data ? Math.max(0, data.totalUnits - data.vacantUnits) : 0;
  const occupancyPercent = data && data.totalUnits > 0
    ? Math.round((occupiedUnits / data.totalUnits) * 100)
    : 0;

  const metrics = data ? [
    { label: "Rent today", value: formatKes(data.rentToday), note: "Collected since midnight", icon: CircleDollarSign, color: "text-ember-300 bg-ember-500/12" },
    { label: "Occupancy", value: `${occupancyPercent}%`, note: `${occupiedUnits} of ${data.totalUnits} units occupied`, icon: Home, color: "text-emerald-200 bg-emerald-500/10" },
    { label: "Rent collected", value: `${data.collectedPercent}%`, note: "Of this month's rent", icon: WalletCards, color: "text-sky-200 bg-sky-500/10" },
    { label: "SMS credits", value: String(data.smsCredits), note: data.smsCredits >= 20 ? "Balance is healthy" : "Balance is running low", icon: MessageSquareText, color: "text-violet-200 bg-violet-500/10" },
  ] : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="grid content-start gap-4">
        <Panel tone="hero" className="relative overflow-hidden p-5 sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-ember-500/15 blur-3xl" aria-hidden />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-graphite-300">Landlord overview</p>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/10 px-3 py-1.5 text-xs text-graphite-200">
                <span className="size-1.5 rounded-full bg-ember-400" />
                Portfolio snapshot
              </span>
            </div>
            <h1 className="mt-5 text-3xl sm:text-4xl">
              {greeting()}, <em className="font-display not-italic text-ember-400">{session?.name}</em>
            </h1>
            {data && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-graphite-200">
                You collected {formatKes(data.rentToday)} today. {data.vacantUnits} of {data.totalUnits} units are currently vacant.
              </p>
            )}
          </div>
        </Panel>

        {isError ? (
          <Panel className="p-6 text-graphite-200">We could not load your summary. Refresh to try again.</Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {isPending
              ? [0, 1, 2, 3].map((item) => <div key={item} className="glass h-36 rounded-2xl p-4"><div className="skeleton h-full rounded-xl" /></div>)
              : metrics.map(({ label, value, note, icon: Icon, color }) => (
                  <Panel key={label} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-graphite-300">{label}</p>
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl ring-1 ring-white/10", color)}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                    </div>
                    <p className="mt-4 font-display text-2xl text-bone sm:text-3xl">{value}</p>
                    <p className="mt-1 text-xs text-graphite-400">{note}</p>
                  </Panel>
                ))}
          </div>
        )}

        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-graphite-400">Portfolio performance</p>
              <h2 className="mt-2 text-2xl text-bone">Rent collection</h2>
            </div>
            {data && (
              <div className="rounded-xl border border-ember-400/20 bg-ember-500/8 px-3 py-2 text-right">
                <p className="text-xs text-graphite-300">Collected this month</p>
                <p className="mt-1 font-display text-xl text-ember-200">{data.collectedPercent}%</p>
              </div>
            )}
          </div>

          {isPending ? (
            <div className="skeleton mt-5 h-24" />
          ) : data ? (
            <div className="mt-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="font-display text-3xl text-bone">{data.collectedPercent}%</p>
                  <p className="mt-1 text-sm text-graphite-400">of this month&apos;s rent collected</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-graphite-300">
                  {data.collectedPercent >= 75 ? "On track" : "In progress"}
                </span>
              </div>
              <div
                className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/8"
                role="progressbar"
                aria-label="Monthly rent collected"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={data.collectedPercent}
              >
                <div className="h-full rounded-full bg-gradient-to-r from-ember-600 to-ember-300 transition-[width]" style={{ width: `${Math.min(100, Math.max(0, data.collectedPercent))}%` }} />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/8 bg-white/3 p-3">
                  <p className="text-xs text-graphite-400">Occupied units</p>
                  <p className="mt-1 font-display text-xl text-bone">{occupiedUnits}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/3 p-3">
                  <p className="text-xs text-graphite-400">Vacant units</p>
                  <p className="mt-1 font-display text-xl text-bone">{data.vacantUnits}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/3 p-3">
                  <p className="text-xs text-graphite-400">Total units</p>
                  <p className="mt-1 font-display text-xl text-bone">{data.totalUnits}</p>
                </div>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      <aside className="grid content-start gap-4">
        <Panel className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-graphite-400">Action centre</p>
              <h2 className="mt-1 text-xl text-bone">What needs you</h2>
            </div>
            {data && <span className="rounded-full bg-ember-500/12 px-2.5 py-1 text-xs text-ember-200">{data.next.length}</span>}
          </div>

          <ul className="mt-4 grid gap-2.5">
            {isPending && <li className="skeleton h-16 rounded-xl" />}
            {data?.next.length === 0 && <li className="rounded-xl border border-white/8 bg-white/3 p-3 text-sm text-graphite-300">Nothing needs you right now.</li>}
            {data?.next.map((item) => {
              const Icon = item.tone === "urgent" ? AlertTriangle : Info;
              return (
                <li key={item.id} className={cn("flex gap-3 rounded-xl border p-3", item.tone === "urgent" ? "border-danger/35 bg-danger/8" : "border-white/8 bg-white/3")}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", item.tone === "urgent" ? "text-danger" : "text-ember-400")} aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-bone">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-graphite-300">{item.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-graphite-400">Account health</p>
          <h2 className="mt-1 text-xl text-bone">Stay up to date</h2>
          <div className="mt-4 grid gap-2.5">
            <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 p-3">
              <span className="grid size-9 place-items-center rounded-xl bg-ember-500/12 text-ember-200"><Building2 className="size-4" aria-hidden /></span>
              <div>
                <p className="text-xs text-graphite-400">Portfolio</p>
                <p className="mt-0.5 text-sm text-bone">{data ? `${data.totalUnits} rental units` : "Loading units..."}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 p-3">
              <span className="grid size-9 place-items-center rounded-xl bg-sky-500/10 text-sky-200"><Clock3 className="size-4" aria-hidden /></span>
              <div>
                <p className="text-xs text-graphite-400">Subscription</p>
                <p className="mt-0.5 text-sm text-bone">{data ? `${data.subscriptionDaysLeft} days remaining` : "Loading status..."}</p>
              </div>
            </div>
            {data && (
              <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 p-3 text-xs text-graphite-300">
                {data.smsCredits >= 20 ? <ArrowUpRight className="size-4 text-emerald-300" aria-hidden /> : <ArrowDownRight className="size-4 text-ember-300" aria-hidden />}
                {data.smsCredits >= 20 ? "SMS balance is in good shape." : "Consider topping up SMS credits."}
              </div>
            )}
          </div>
        </Panel>
      </aside>
    </div>
  );
}
