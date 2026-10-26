import { useState } from "react";
import type { AdminViewing, VisitStatus } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useAdminViewings, useUpdateViewing } from "@/features/admin/hooks";

const TONE: Record<VisitStatus, "ember" | "ok" | "neutral" | "danger"> = { new: "ember", contacted: "neutral", scheduled: "ok", rescheduled: "ok", done: "ok", no_show: "danger", house_taken: "danger", cancelled: "neutral" };
const LABEL: Record<VisitStatus, string> = { new: "New", contacted: "Contacted", scheduled: "Scheduled", rescheduled: "Rescheduled", done: "Done", no_show: "No-show", house_taken: "House taken", cancelled: "Cancelled" };

/** Seven days starting today. The database allows today up to seven days ahead, counted by its own clock, so we stop at six days out. */
function dateOptions() {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" }) });
  }
  return out;
}

function Row({ v }: { v: AdminViewing }) {
  const update = useUpdateViewing();
  const dates = dateOptions();
  const [date, setDate] = useState(dates[0]!.value);
  const [win, setWin] = useState(v.timeWindow);
  const [note, setNote] = useState(v.adminNotes ?? "");
  const set = (status: VisitStatus) => update.mutate({ id: v.id, patch: { status } });
  const open = v.status === "new" || v.status === "contacted" || v.status === "scheduled" || v.status === "rescheduled";

  return (
    <div className="grid gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-medium">{v.visitorName}</p>
          <p className="text-sm text-graphite-300"><a className="text-ember-300 underline-offset-4 hover:underline" href={`https://wa.me/254${v.visitorPhone.slice(1)}`} target="_blank" rel="noopener noreferrer">{v.visitorPhone}</a> · {v.houseTitle} ({v.landlordName})</p>
          <p className="text-sm text-graphite-300">Wants {new Date(v.preferredDate).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}, {v.timeWindow.toLowerCase()}</p>
          {v.scheduledDate && <p className="text-sm text-ok">Scheduled {new Date(v.scheduledDate).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}, {v.scheduledWindow?.toLowerCase()}{v.rescheduleCount ? ` (rescheduled ${v.rescheduleCount}x)` : ""}</p>}
        </div>
        <Chip tone={TONE[v.status]}>{LABEL[v.status]}</Chip>
      </div>
      {v.status === "contacted" && (
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <SelectField label="Date" value={date} onChange={(e) => setDate(e.target.value)}>{dates.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</SelectField>
          <SelectField label="Time" value={win} onChange={(e) => setWin(e.target.value)}>{["Morning", "Afternoon", "Evening"].map((w) => <option key={w}>{w}</option>)}</SelectField>
          <Button loading={update.isPending} onClick={() => update.mutate({ id: v.id, patch: { status: "scheduled", scheduledDate: date, scheduledWindow: win } })}>Schedule</Button>
        </div>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {v.status === "new" && <Button size="sm" loading={update.isPending} onClick={() => set("contacted")}>Mark contacted</Button>}
          {(v.status === "scheduled" || v.status === "rescheduled") && <><Button size="sm" onClick={() => set("done")}>Done</Button><Button variant="glass" size="sm" onClick={() => set("no_show")}>No-show</Button></>}
          <Button variant="glass" size="sm" onClick={() => set("house_taken")}>House taken</Button>
          <Button variant="ghost" size="sm" onClick={() => set("cancelled")}>Cancel</Button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <Field className="flex-1" label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called, will come at 10" />
        <Button variant="glass" size="sm" disabled={note === (v.adminNotes ?? "")} onClick={() => update.mutate({ id: v.id, patch: { notes: note } })}>Save note</Button>
      </div>
      <ErrorNote error={update.error} />
    </div>
  );
}

export default function Viewings() {
  const { data, isPending, error } = useAdminViewings();
  return (
    <div className="grid gap-4">
      <PageHead title="Viewing requests" sub="Visitors send their contact details and preferred time. Contact them, schedule, and record how it went." />
      <ErrorNote error={error} />
      {isPending && <div className="skeleton h-32" />}
      <Panel className="divide-y divide-white/8">
        {data?.length === 0 && <p className="p-6 text-graphite-300">No viewing requests yet.</p>}
        {data?.map((v) => <Row key={v.id} v={v} />)}
      </Panel>
    </div>
  );
}
