import { useState } from "react";
import { api } from "@/api";
import type { VisitItem, VisitPatch, VisitStatus } from "@/api/types";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDay, nextDays } from "@/lib/format";

const TONE: Record<VisitStatus, "ember" | "ok" | "neutral" | "danger"> = {
  new: "ember", contacted: "neutral", scheduled: "ok", rescheduled: "ok", done: "ok", no_show: "danger", house_taken: "danger", cancelled: "neutral",
};
const LABEL: Record<VisitStatus, string> = {
  new: "New", contacted: "Contacted", scheduled: "Scheduled", rescheduled: "Rescheduled", done: "Done", no_show: "No-show", house_taken: "House taken", cancelled: "Cancelled",
};
const WINDOWS = ["Morning", "Afternoon", "Evening"];

function ViewingRow({ visit }: { visit: VisitItem }) {
  const days = nextDays();
  const [open, setOpen] = useState<string | null>(null);
  const [date, setDate] = useState(() => days.some((d) => d.value === visit.preferredDate) ? visit.preferredDate : days[0]!.value);
  const preferredWindow = WINDOWS.includes(visit.timeWindow) ? visit.timeWindow : "Morning";
  const [win, setWin] = useState(visit.scheduledWindow ?? preferredWindow);
  const update = useLiveMutation("landlord", (v: { id: string; patch: VisitPatch }) => api.landlord.updateVisit(v.id, v.patch));
  const resched = useLiveMutation("landlord", (v: { id: string; date: string; window: string }) => api.landlord.reschedule(v.id, v.date, v.window));
  const changeStatus = (status: VisitStatus) => update.mutate({ id: visit.id, patch: { status } });
  const canReschedule = (visit.status === "scheduled" || visit.status === "rescheduled") && visit.reschedules < 2;

  return (
    <div className="grid gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-medium">{visit.visitorName}</p>
          <p className="text-sm text-graphite-300"><a className="text-ember-300 hover:underline" href={`https://wa.me/254${visit.visitorPhone.slice(1)}`} target="_blank" rel="noopener noreferrer">{visit.visitorPhone}</a> · {visit.houseTitle}</p>
          <p className="text-sm text-graphite-300">Prefers {fmtDay(visit.preferredDate)}, {visit.timeWindow.toLowerCase()}</p>
          {visit.scheduledDate && <p className="text-sm text-ok">Scheduled {fmtDay(visit.scheduledDate)}, {visit.scheduledWindow?.toLowerCase()}{visit.reschedules ? ` · rescheduled ${visit.reschedules} of 2` : ""}</p>}
        </div>
        <Chip tone={TONE[visit.status]}>{LABEL[visit.status]}</Chip>
      </div>
      {visit.status === "new" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={update.isPending} onClick={() => changeStatus("contacted")}>Mark contacted</Button>
          <Button variant="glass" size="sm" loading={update.isPending} onClick={() => changeStatus("house_taken")}>House taken</Button>
          <Button variant="ghost" size="sm" loading={update.isPending} onClick={() => changeStatus("cancelled")}>Cancel request</Button>
        </div>
      )}
      {visit.status === "contacted" && (
        <>
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <SelectField label="Viewing day" value={date} onChange={(e) => setDate(e.target.value)}>{days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</SelectField>
            <SelectField label="Time of day" value={win} onChange={(e) => setWin(e.target.value)}>{WINDOWS.map((w) => <option key={w}>{w}</option>)}</SelectField>
            <Button loading={update.isPending} onClick={() => update.mutate({ id: visit.id, patch: { status: "scheduled", scheduledDate: date, scheduledWindow: win } })}>Schedule viewing</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="glass" size="sm" loading={update.isPending} onClick={() => changeStatus("house_taken")}>House taken</Button>
            <Button variant="ghost" size="sm" loading={update.isPending} onClick={() => changeStatus("cancelled")}>Cancel request</Button>
          </div>
        </>
      )}
      {(visit.status === "scheduled" || visit.status === "rescheduled") && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={update.isPending} onClick={() => changeStatus("done")}>Done</Button>
            <Button variant="glass" size="sm" loading={update.isPending} onClick={() => changeStatus("no_show")}>No-show</Button>
            <Button variant="glass" size="sm" loading={update.isPending} onClick={() => changeStatus("house_taken")}>House taken</Button>
            <Button variant="ghost" size="sm" loading={update.isPending} onClick={() => changeStatus("cancelled")}>Cancel</Button>
            {canReschedule && open !== visit.id && <Button variant="glass" size="sm" onClick={() => { setDate(visit.scheduledDate ?? days[0]!.value); setWin(visit.scheduledWindow ?? preferredWindow); setOpen(visit.id); }}>Reschedule</Button>}
          </div>
          {open === visit.id && (
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
              <SelectField label="New day" value={date} onChange={(e) => setDate(e.target.value)}>{days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</SelectField>
              <SelectField label="Time of day" value={win} onChange={(e) => setWin(e.target.value)}>{WINDOWS.map((w) => <option key={w}>{w}</option>)}</SelectField>
              <Button loading={resched.isPending} onClick={() => resched.mutate({ id: visit.id, date, window: win }, { onSuccess: () => setOpen(null) })}>Reschedule</Button>
              <Button variant="ghost" onClick={() => setOpen(null)}>Close</Button>
            </div>
          )}
        </>
      )}
      <ErrorNote error={update.error ?? resched.error} />
    </div>
  );
}

export default function Visits() {
  const { data, isPending, error } = useLive("landlord", "visits", () => api.landlord.visits());
  return (
    <div className="grid gap-4">
      <PageHead title="Viewings" sub="Contact visitors directly, review their preferred time, schedule viewings, and record the outcome." />
      <ErrorNote error={error} />
      {isPending && <div className="skeleton h-24" />}
      {data?.length === 0 && <Panel className="p-4"><ToLet title="No viewing requests yet" note="New requests from visitors will appear here for you to manage." /></Panel>}
      <Panel className="divide-y divide-white/8">
        {data?.map((visit) => <ViewingRow key={visit.id} visit={visit} />)}
      </Panel>
    </div>
  );
}
