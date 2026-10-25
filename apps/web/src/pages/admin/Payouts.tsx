import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useAdminPayouts, useMarkPayoutPaid } from "@/features/admin/hooks";
import { fmtDate, formatKes } from "@/lib/format";

export default function Payouts() {
  const { data, isPending, error } = useAdminPayouts();
  const mark = useMarkPayoutPaid();
  const [open, setOpen] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [problem, setProblem] = useState<string>();
  const confirm = (id: string) => { if (ref.trim().length < 8) return setProblem("Enter the full M-Pesa reference."); setProblem(undefined); mark.mutate({ id, ref: ref.trim() }, { onSuccess: () => { setOpen(null); setRef(""); } }); };

  return (
    <div className="grid gap-4">
      <PageHead title="Payouts" sub="Rent collected on the platform Paybill that is owed to landlords. Pay them by M-Pesa, then record the reference." />
      <ErrorNote error={error ?? mark.error} />
      {isPending && <div className="skeleton h-24" />}
      <Panel className="divide-y divide-white/8">
        {data?.length === 0 && <p className="p-6 text-graphite-300">No payouts yet. They are created on the schedule you set.</p>}
        {data?.map((p) => (
          <div key={p.id} className="grid gap-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-lg font-medium">{p.landlordName}</p><p className="text-sm text-graphite-300">{formatKes(p.amount)} · {p.destinationKind === "mpesa_phone" ? `M-Pesa ${p.destination}` : `Bank paybill ${p.destination}, account ${p.accountRef}`}</p><p className="text-sm text-graphite-400">Created {fmtDate(p.at)}{p.ref ? ` · paid ${fmtDate(p.paidAt)} · ${p.ref}` : ""}</p></div>
              <div className="flex items-center gap-2"><Chip tone={p.status === "paid" ? "ok" : "ember"}>{p.status}</Chip>{p.status !== "paid" && open !== p.id && <Button size="sm" onClick={() => { setOpen(p.id); setRef(""); setProblem(undefined); }}>Mark paid</Button>}</div>
            </div>
            {open === p.id && (
              <div className="grid gap-3 rounded-xl border border-white/10 bg-white/4 p-4">
                <Field label="M-Pesa reference of your payment" value={ref} onChange={(e) => setRef(e.target.value)} error={problem} />
                <div className="flex gap-2"><Button loading={mark.isPending} onClick={() => confirm(p.id)}>Confirm payout</Button><Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button></div>
              </div>
            )}
          </div>
        ))}
      </Panel>
    </div>
  );
}
