import { useState } from "react";
import { priceFormula } from "@rh/shared";
import type { AdminLandlord } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useAdminLandlords, useResume, useSendReminder, useSuspend } from "@/features/admin/hooks";
import { formatKes } from "@/lib/format";

const SETTING_UP = ["pending_email", "pending_phone", "pending_kyc", "kyc_submitted"];
const hoursSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : Infinity);

export function StatusChip({ l }: { l: AdminLandlord }) {
  if (l.state === "suspended") return <Chip tone="danger">Suspended</Chip>;
  if (l.state === "expired") return <Chip tone="danger">Expired {l.daysLeft !== null ? `${Math.abs(l.daysLeft)} days ago` : ""}</Chip>;
  if (l.state === "active") return <Chip tone={(l.daysLeft ?? 99) <= 7 ? "ember" : "ok"}>{l.daysLeft} days left</Chip>;
  if (l.state === "kyc_approved") return <Chip tone="ember">Verified, not paid</Chip>;
  return <Chip>Setting up</Chip>;
}

export default function Subscriptions() {
  const { data, isPending, error } = useAdminLandlords();
  const suspend = useSuspend(), resume = useResume(), remind = useSendReminder();
  const [open, setOpen] = useState<{ id: string; mode: "suspend" | "resume" } | null>(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string>();
  const [sent, setSent] = useState<string>();

  const list = (data ?? []).filter((l) => !SETTING_UP.includes(l.state));
  const count = (f: (l: AdminLandlord) => boolean) => list.filter(f).length;
  const close = () => { setOpen(null); setText(""); setProblem(undefined); };

  const submit = (l: AdminLandlord) => {
    if (open?.mode === "suspend") {
      if (!text.trim()) return setProblem("Give a reason. It is logged.");
      suspend.mutate({ id: l.id, reason: text.trim() }, { onSuccess: close });
    } else {
      if (text.trim().length < 8) return setProblem("Enter the full M-Pesa reference before resuming.");
      resume.mutate({ id: l.id, ref: text.trim(), amount: l.monthlyPrice }, { onSuccess: close });
    }
  };

  return (
    <div className="grid gap-4">
      <PageHead title="Subscriptions" sub="Each landlord's houses tally with their monthly payment. Reminders go by SMS from your Celcom credit." />
      <ErrorNote error={error} />
      <Stats loading={isPending} items={[
        { label: "Active", value: String(count((l) => l.state === "active" && (l.daysLeft ?? 99) > 7)) },
        { label: "Expiring soon", value: String(count((l) => l.state === "active" && (l.daysLeft ?? 99) <= 7)), tone: "warn" },
        { label: "Expired", value: String(count((l) => l.state === "expired")) },
        { label: "Suspended", value: String(count((l) => l.state === "suspended")) },
      ]} />
      {sent && <p role="status" className="text-sm text-ok">{sent}</p>}
      <ErrorNote error={remind.error ?? suspend.error ?? resume.error} />
      <Panel className="divide-y divide-white/8">
        {list.length === 0 && !isPending && <p className="p-6 text-graphite-300">No landlords on a plan yet.</p>}
        {list.map((l) => {
          const canRemind = (l.state === "active" || l.state === "expired") && !!l.phone && hoursSince(l.lastReminderAt) >= 24;
          const payable = l.state === "suspended" || l.state === "expired" || l.state === "kyc_approved";
          return (
            <div key={l.id} className="grid gap-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-medium">{l.name}</p>
                  <p className="text-sm text-graphite-300">{priceFormula(l.units)}</p>
                  {l.suspendedReason && <p className="mt-1 text-sm text-danger">{l.suspendedReason}</p>}
                  {l.lastReminderAt && <p className="mt-1 text-sm text-ok">Last reminder {new Date(l.lastReminderAt).toLocaleDateString("en-KE")}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip l={l} />
                  {(l.state === "active" || l.state === "expired") && (
                    <Button variant="glass" size="sm" disabled={!canRemind || remind.isPending} onClick={() => remind.mutate(l.id, { onSuccess: () => setSent(`Reminder sent to ${l.name}.`) })}>Send reminder</Button>
                  )}
                  {payable && <Button size="sm" onClick={() => { setOpen({ id: l.id, mode: "resume" }); setText(""); setProblem(undefined); }}>{l.state === "kyc_approved" ? "Record payment" : "Resume"}</Button>}
                  {(l.state === "active" || l.state === "expired") && <Button variant="ghost" size="sm" onClick={() => { setOpen({ id: l.id, mode: "suspend" }); setText(""); setProblem(undefined); }}>Suspend</Button>}
                </div>
              </div>
              {open?.id === l.id && (
                <div className="grid gap-3 rounded-xl border border-white/10 bg-white/4 p-4">
                  <p className="text-sm text-graphite-300">
                    {open.mode === "suspend" ? "Suspending hides their houses, blocks new viewings, and pauses their tenants' access." : `Amount due: ${formatKes(l.monthlyPrice)}. Enter the M-Pesa reference you checked.`}
                  </p>
                  <Field label={open.mode === "suspend" ? "Reason" : "M-Pesa reference"} value={text} onChange={(e) => setText(e.target.value)} error={problem} />
                  <div className="flex gap-2">
                    <Button loading={suspend.isPending || resume.isPending} onClick={() => submit(l)}>{open.mode === "suspend" ? "Confirm suspend" : "Confirm and activate"}</Button>
                    <Button variant="ghost" onClick={close}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
