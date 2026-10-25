import { api } from "@/api";
import { ToLet } from "@/components/motion/Doodles";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive } from "@/features/live";

/** A caretaker sees who lives where and how to reach them. Never rent, payments or balances. */
export default function CaretakerTenants() {
  const { data, error } = useLive("landlord", "tenants", () => api.landlord.tenants());
  const list = (data ?? []).filter((t) => t.status !== "ended");
  return (
    <div className="grid gap-4">
      <PageHead title="Tenants" sub="In the houses you look after." />
      <ErrorNote error={error} />
      {data && list.length === 0 && <Panel className="p-4"><ToLet title="No tenants yet" /></Panel>}
      <Panel className="divide-y divide-white/8">
        {list.map((t) => (
          <div key={t.id} className="grid gap-1 p-5">
            <p className="text-lg font-medium">{t.name} <span className="text-graphite-400">{t.houseTitle}, unit {t.unit}</span></p>
            <p className="text-sm text-graphite-300">Phone {t.phone}</p>
            <p className="text-sm text-graphite-300">Emergency: {t.emergencyName} ({t.emergencyRelationship}) {t.emergencyPhone}</p>
          </div>
        ))}
      </Panel>
    </div>
  );
}
