import { useState } from "react";
import { kenyanPhone } from "@rh/shared";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate } from "@/lib/format";

export default function Documents() {
  const home = useLive("tenant", "home", () => api.tenant.home());
  const save = useLiveMutation("tenant", (v: { name: string; phone: string; rel: string }) => api.tenant.updateEmergency(v.name, v.phone, v.rel));
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", rel: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string>();
  const t = home.data?.tenancy;

  const open = async () => {
    if (!t?.agreementPath) return;
    setOpening(true); setProblem(undefined);
    try { window.open(await api.tenant.agreementUrl(t.agreementPath), "_blank", "noopener,noreferrer"); } catch (e) { setProblem(e instanceof Error ? e.message : "We could not open the file"); } finally { setOpening(false); }
  };
  const submit = () => {
    const p = kenyanPhone.safeParse(f.phone);
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = "Enter their name";
    if (f.rel.trim().length < 2) e.rel = "Enter how they are related";
    if (!p.success) e.phone = p.error.issues[0]?.message ?? "Enter a valid phone number";
    setErrs(e);
    if (!Object.keys(e).length && p.success) save.mutate({ name: f.name.trim(), phone: p.data, rel: f.rel.trim() }, { onSuccess: () => setEditing(false) });
  };

  return (
    <div className="grid gap-4">
      <PageHead title="Documents" sub="Your tenancy papers and details." />
      <ErrorNote error={home.error} />
      <Panel className="grid gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl">Tenancy agreement</h2>{t?.agreementPath ? <Chip tone="ok">Scan available</Chip> : t?.agreementSignedOn ? <Chip tone="ok">Signed on paper</Chip> : <Chip>Not signed yet</Chip>}</div>
        {t?.agreementSignedOn && <p className="text-graphite-300">Signed on {fmtDate(t.agreementSignedOn)}. Keep your paper copy safe.</p>}
        {t?.agreementPath ? <div><Button variant="glass" loading={opening} onClick={() => void open()}>Download the signed copy</Button></div> : <p className="text-graphite-300">{t?.agreementSignedOn ? "Your landlord has not uploaded a scan. Your signed paper copy is your record." : "Your agreement is printed the day before you move in and signed when you pay the deposit."}</p>}
        {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      </Panel>
      <Panel className="grid gap-3 p-5 sm:p-6">
        <h2 className="text-xl">Emergency contact</h2>
        {t && !editing && <><p><span className="text-bone">{t.emergencyName}</span> ({t.emergencyRelationship}) {t.emergencyPhone}</p><p className="text-sm text-graphite-400">Your landlord can see this contact.</p><div><Button variant="glass" size="sm" onClick={() => { setF({ name: t.emergencyName, phone: t.emergencyPhone, rel: t.emergencyRelationship }); setEditing(true); }}>Edit</Button></div></>}
        {editing && (
          <div className="grid gap-4">
            <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
            <Field label="Phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} hint="Must be a different number from your own" />
            <Field label="Relationship" value={f.rel} onChange={(e) => setF({ ...f, rel: e.target.value })} error={errs.rel} />
            <ErrorNote error={save.error} />
            <div className="flex gap-2"><Button loading={save.isPending} onClick={submit}>Save</Button><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
          </div>
        )}
      </Panel>
    </div>
  );
}
