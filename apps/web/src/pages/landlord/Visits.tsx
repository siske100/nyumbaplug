import { useState } from "react";
import { api } from "@/api";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDay, nextDays } from "@/lib/format";

export default function Visits() {
  const { data, isPending, error } = useLive("landlord", "visits", () => api.landlord.visits());
  const resched = useLiveMutation("landlord", (v: { id: string; date: string; window: string }) => api.landlord.reschedule(v.id, v.date, v.window));
  const days = nextDays();
  const [open, setOpen] = useState<string | null>(null);
  const [date, setDate] = useState(days[0]!.value);
  const [win, setWin] = useState("Morning");

  return (
    <div className="grid gap-4">
      <PageHead title="Viewings" sub="Contact visitors directly on WhatsApp to arrange a time. Their selected day and time are preferences; you can reschedule arranged viewings up to twice." />
      <ErrorNote error={error ?? resched.error} />
      {isPending && <div className="skeleton h-24" />}
      {data?.length === 0 && <Panel className="p-4"><ToLet title="No viewings scheduled" note="They appear here once our team has arranged a time with a visitor." /></Panel>}
      <Panel className="divide-y divide-white/8">
        {data?.map((v) => {
          const can = (v.status === "scheduled" || v.status === "rescheduled") && v.reschedules < 2;
          return (
            <div key={v.id} className="grid gap-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-medium">{v.visitorName}</p>
                  <p className="text-sm text-graphite-300"><a className="text-ember-300 hover:underline" href={`https://wa.me/254${v.visitorPhone.slice(1)}`} target="_blank" rel="noopener noreferrer">{v.visitorPhone}</a> · {v.houseTitle}</p>
                  <p className="text-sm text-graphite-300">{fmtDay(v.date)}, {v.window?.toLowerCase()}{v.reschedules ? ` · rescheduled ${v.reschedules} of 2` : ""}</p>
                </div>
                <div className="flex items-center gap-2"><Chip tone={v.status === "done" ? "ok" : v.status === "no_show" || v.status === "house_taken" ? "danger" : "ember"}>{v.status.replace("_", " ")}</Chip>{can && open !== v.id && <Button variant="glass" size="sm" onClick={() => setOpen(v.id)}>Reschedule</Button>}</div>
              </div>
              {open === v.id && (
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                  <SelectField label="New day" value={date} onChange={(e) => setDate(e.target.value)}>{days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</SelectField>
                  <SelectField label="Time of day" value={win} onChange={(e) => setWin(e.target.value)}>{["Morning", "Afternoon", "Evening"].map((w) => <option key={w}>{w}</option>)}</SelectField>
                  <Button loading={resched.isPending} onClick={() => resched.mutate({ id: v.id, date, window: win }, { onSuccess: () => setOpen(null) })}>Reschedule and notify</Button>
                  <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
                </div>
              )}
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
