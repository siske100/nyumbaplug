import { useState } from "react";
import { api } from "@/api";
import type { ComplaintItem } from "@/api/types";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";

type Role = "landlord" | "caretaker" | "tenant";
const TONE = { open: "danger", in_progress: "ember", resolved: "ok" } as const;
const LABEL = { open: "Open", in_progress: "In progress", resolved: "Resolved" } as const;
const CATEGORIES = ["Water", "Electricity", "Plumbing", "Security", "Other"];

function NewComplaint({ onDone }: { onDone: () => void }) {
  const home = useLive("tenant", "home", () => api.tenant.home());
  const create = useLiveMutation("tenant", (v: { category: string; title: string; body: string }) => api.tenant.newComplaint(home.data!.tenancy.id, v.category, v.title, v.body));
  const [f, setF] = useState({ category: "Water", title: "", body: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 3) e.title = "Give it a short title";
    if (f.body.trim().length < 10) e.body = "Describe the problem in at least 10 characters";
    setErrs(e);
    if (!Object.keys(e).length) create.mutate({ category: f.category, title: f.title.trim(), body: f.body.trim() }, { onSuccess: onDone });
  };
  return (
    <Panel tone="hero" className="grid gap-4 p-5 sm:p-6">
      <h2 className="text-2xl">Tell your landlord about a problem</h2>
      <SelectField label="What is it about?" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</SelectField>
      <Field label="Short title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errs.title} />
      <div>
        <label htmlFor="cbody" className="mb-1.5 block text-sm text-graphite-200">What is wrong?</label>
        <textarea id="cbody" rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-invalid={!!errs.body} className="w-full rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 focus:border-ember-400/70 focus:outline-none" />
        {errs.body && <p role="alert" className="mt-1.5 text-sm text-danger">{errs.body}</p>}
      </div>
      <ErrorNote error={create.error} />
      <div className="flex gap-2"><Button magnetic loading={create.isPending} disabled={!home.data} onClick={submit}>Send to landlord</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
    </Panel>
  );
}

export function ComplaintsView({ role }: { role: Role }) {
  const scope = role === "tenant" ? "tenant" : "landlord";
  const list = useLive(scope, "complaints", () => (role === "tenant" ? api.tenant.complaints() : api.landlord.complaints()), { refetchInterval: 20_000 });
  const reply = useLiveMutation(scope, (v: { id: string; body: string }) => (role === "tenant" ? api.tenant.replyComplaint(v.id, v.body) : api.landlord.replyComplaint(v.id, v.body)));
  const status = useLiveMutation("landlord", (v: { id: string; status: ComplaintItem["status"] }) => api.landlord.updateComplaint(v.id, { status: v.status }));
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const items = list.data ?? [];
  const cur = items.find((c) => c.id === sel) ?? items[0];

  const send = () => {
    if (!cur || !text.trim()) return;
    reply.mutate({ id: cur.id, body: text.trim() }, { onSuccess: () => { setText(""); if (role === "landlord" && cur.status === "open") status.mutate({ id: cur.id, status: "in_progress" }); } });
  };

  return (
    <div className="grid gap-4">
      <PageHead title="Complaints" sub={role === "tenant" ? "Report a problem and follow what happens." : "Problems your tenants report. Reply, and mark them in progress or resolved."} action={role === "tenant" && !adding && <Button magnetic onClick={() => setAdding(true)}>New complaint</Button>} />
      {adding && <NewComplaint onDone={() => setAdding(false)} />}
      <ErrorNote error={list.error} />
      {list.isPending && <div className="skeleton h-24" />}
      {list.data && items.length === 0 && !adding && <Panel className="p-4"><ToLet title="No complaints" note={role === "tenant" ? "Everything fine? Good. If something breaks, report it here." : "Nothing reported. Quiet is good."} /></Panel>}
      {cur && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Panel className="p-2">
            {items.map((c) => (
              <button key={c.id} onClick={() => setSel(c.id)} className={cn("w-full rounded-xl px-3 py-2.5 text-left", c.id === cur.id ? "bg-white/10" : "hover:bg-white/6")}>
                <div className="flex items-center justify-between gap-2"><p className="truncate font-medium">{c.title}</p><Chip tone={TONE[c.status]}>{LABEL[c.status]}</Chip></div>
                <p className="truncate text-sm text-graphite-300">{role === "tenant" ? c.category : `${c.tenantName}, ${c.houseTitle} ${c.unit}`} · {fmtDate(c.at)}</p>
              </button>
            ))}
          </Panel>
          <Panel className="grid content-start gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="text-xl">{cur.title}</h2><p className="text-sm text-graphite-300">{cur.category}{role !== "tenant" && ` · ${cur.tenantName}, ${cur.houseTitle} unit ${cur.unit}`}</p></div>
              <Chip tone={TONE[cur.status]}>{LABEL[cur.status]}</Chip>
            </div>
            <div className="grid gap-2" aria-live="polite">
              {cur.messages.map((m) => <div key={m.id} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", m.mine ? "ml-auto bg-ember-500/20" : "bg-white/8")}>{m.body}<p className="mt-1 text-xs text-graphite-400">{fmtDate(m.at)}</p></div>)}
            </div>
            {cur.status !== "resolved" && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <input aria-label="Your message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" maxLength={2000} className="flex-1 rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 focus:border-ember-400/70 focus:outline-none" />
                <Button type="submit" loading={reply.isPending} disabled={!text.trim()}>Send</Button>
              </form>
            )}
            <ErrorNote error={reply.error ?? status.error} />
            {role === "landlord" && cur.status !== "resolved" && (
              <div className="flex gap-2">
                {cur.status === "open" && <Button variant="glass" size="sm" onClick={() => status.mutate({ id: cur.id, status: "in_progress" })}>Mark in progress</Button>}
                <Button variant="glass" size="sm" onClick={() => status.mutate({ id: cur.id, status: "resolved" })}>Mark resolved</Button>
              </div>
            )}
            {role === "tenant" && <p className="text-sm text-graphite-400">Your landlord is notified when you write.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}
