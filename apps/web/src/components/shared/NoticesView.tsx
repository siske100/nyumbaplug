import { useState } from "react";
import { api } from "@/api";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLandlordHouses } from "@/features/landlord/hooks";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate } from "@/lib/format";

function Post() {
  const houses = useLandlordHouses();
  const post = useLiveMutation("landlord", (v: { title: string; body: string; houseId: string | null }) => api.landlord.postNotice(v.title, v.body, v.houseId));
  const [f, setF] = useState({ title: "", body: "", houseId: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 3) e.title = "Give the notice a title";
    if (!f.body.trim()) e.body = "Write the notice";
    setErrs(e);
    if (!Object.keys(e).length) post.mutate({ title: f.title.trim(), body: f.body.trim(), houseId: f.houseId || null }, { onSuccess: () => setF({ title: "", body: "", houseId: "" }) });
  };
  return (
    <Panel className="grid gap-4 p-5 sm:p-6">
      <h2 className="text-xl">Post a notice</h2>
      <p className="text-sm text-graphite-300">Appears in your tenants' notice board. It does not cost an SMS. To text people, use the SMS page.</p>
      <SelectField label="Who sees it" value={f.houseId} onChange={(e) => setF({ ...f, houseId: e.target.value })}><option value="">All my tenants</option>{houses.data?.map((h) => <option key={h.id} value={h.id}>Only {h.title}</option>)}</SelectField>
      <Field label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errs.title} />
      <div>
        <label htmlFor="nbody" className="mb-1.5 block text-sm text-graphite-200">Notice</label>
        <textarea id="nbody" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="w-full rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 focus:border-ember-400/70 focus:outline-none" />
        {errs.body && <p role="alert" className="mt-1.5 text-sm text-danger">{errs.body}</p>}
      </div>
      <ErrorNote error={post.error} />
      <div><Button magnetic loading={post.isPending} onClick={submit}>Post notice</Button></div>
    </Panel>
  );
}

export function NoticesView({ role }: { role: "landlord" | "tenant" }) {
  const list = useLive(role, "notices", () => (role === "tenant" ? api.tenant.notices() : api.landlord.notices()));
  return (
    <div className="grid gap-4">
      <PageHead title="Notices" sub={role === "tenant" ? "Messages from your landlord." : "Announcements for your tenants."} />
      {role === "landlord" && <Post />}
      <ErrorNote error={list.error} />
      {list.data?.length === 0 && <Panel className="p-4"><ToLet title="No notices" /></Panel>}
      <div className="grid gap-3">
        {list.data?.map((n) => <Panel key={n.id} className="p-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-xl">{n.title}</h2><span className="text-sm text-graphite-400">{fmtDate(n.at)}</span></div><p className="mt-2 whitespace-pre-wrap text-graphite-200">{n.body}</p></Panel>)}
      </div>
    </div>
  );
}
