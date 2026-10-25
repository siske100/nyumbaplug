import { AlertTriangle, Info } from "lucide-react";
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

  return (
    <div className="grid gap-4">
      <Panel tone="hero" className="p-6 sm:p-8">
        <h1 className="text-3xl sm:text-4xl">
          {greeting()}, <em className="font-display not-italic text-ember-400">{session?.name}</em>
        </h1>
        {data && (
          <p className="mt-2 text-graphite-200">
            {formatKes(data.rentToday)} collected since midnight, and {data.vacantUnits} of {data.totalUnits} units are vacant.
          </p>
        )}
      </Panel>

      {isError ? (
        <Panel className="p-6 text-graphite-200">We could not load your summary. Refresh to try again.</Panel>
      ) : (
        <Panel className="grid grid-cols-2 divide-white/8 lg:grid-cols-4 lg:divide-x">
          {isPending
            ? [0, 1, 2, 3].map((i) => <div key={i} className="skeleton m-4 h-16" />)
            : [
                { label: "Rent today", value: formatKes(data.rentToday), note: "since midnight" },
                { label: "Vacant units", value: String(data.vacantUnits), note: `of ${data.totalUnits} units` },
                { label: "Collected", value: `${data.collectedPercent}%`, note: "of this month's rent" },
                { label: "SMS credits", value: String(data.smsCredits), note: data.smsCredits >= 20 ? "Healthy" : "Running low" },
              ].map((s) => (
                <div key={s.label} className="p-5">
                  <p className="text-sm text-graphite-300">{s.label}</p>
                  <p className="mt-1 font-display text-3xl">{s.value}</p>
                  <p className="mt-0.5 text-sm text-graphite-400">{s.note}</p>
                </div>
              ))}
        </Panel>
      )}

      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">What needs you</h2>
        <ul className="mt-4 grid gap-2.5">
          {isPending && <li className="skeleton h-14" />}
          {data?.next.length === 0 && <li className="text-graphite-300">Nothing needs you right now.</li>}
          {data?.next.map((n) => {
            const Icon = n.tone === "urgent" ? AlertTriangle : Info;
            return (
              <li key={n.id} className={cn("flex gap-3 rounded-xl border p-3.5", n.tone === "urgent" ? "border-danger/35 bg-danger/8" : "border-white/8 bg-white/4")}>
                <Icon className={cn("mt-0.5 size-5 shrink-0", n.tone === "urgent" ? "text-danger" : "text-ember-400")} aria-hidden />
                <div><p className="font-medium">{n.title}</p><p className="text-sm text-graphite-300">{n.detail}</p></div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
