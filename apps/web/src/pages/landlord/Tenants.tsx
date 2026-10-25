import { useState } from "react";
import { Link } from "react-router-dom";
import { tenantSchema } from "@rh/shared";
import type { InviteResult, TenancyRow } from "@/api/types";
import { api } from "@/api";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { FileField } from "@/components/ui/FileField";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLandlordHouses } from "@/features/landlord/hooks";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes, todayIso } from "@/lib/format";

function AddTenant({ onDone }: { onDone: () => void }) {
  const houses = useLandlordHouses();
  const add = useLiveMutation("landlord", (v: Parameters<typeof api.landlord.addTenant>[0]) => api.landlord.addTenant(v));
  const [f, setF] = useState({ houseId: "", unit: "", name: "", phone: "", emergencyName: "", emergencyPhone: "", emergencyRelationship: "", rent: "", deposit: "", dueDay: "5" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const house = houses.data?.find((h) => h.id === f.houseId);

  const submit = () => {
    const r = tenantSchema.safeParse({ name: f.name, phone: f.phone, emergencyName: f.emergencyName, emergencyPhone: f.emergencyPhone, emergencyRelationship: f.emergencyRelationship, unitLabel: f.unit });
    const e: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) e[String(i.path[0])] ??= i.message;
    if (!house) e.houseId = "Choose a house";
    else if (house.vacant < 1) e.houseId = "No vacant units in this listing";
    const rent = Number(f.rent || house?.rent), due = Number(f.dueDay);
    if (!(rent > 0)) e.rent = "Enter the monthly rent";
    if (!(due >= 1 && due <= 28)) e.dueDay = "Pick a day from 1 to 28";
    setErrs(e);
    if (Object.keys(e).length || !r.success || !house) return;
    add.mutate({ houseId: house.id, unit: r.data.unitLabel, name: r.data.name, phone: r.data.phone, emergencyName: r.data.emergencyName, emergencyPhone: r.data.emergencyPhone, emergencyRelationship: r.data.emergencyRelationship, rent, deposit: Number(f.deposit || rent), dueDay: due }, { onSuccess: onDone });
  };

  return (
    <Panel tone="hero" className="grid gap-4 p-5 sm:p-6">
      <h2 className="text-2xl">Add a tenant</h2>
      <p className="text-graphite-300">The tenant's phone and an emergency contact are required. Moving a tenant in lowers the vacant count by one.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="House" value={f.houseId} onChange={(e) => { const h = houses.data?.find((x) => x.id === e.target.value); setF({ ...f, houseId: e.target.value, rent: h ? String(h.rent) : "", deposit: h ? String(h.deposit) : "" }); }} error={errs.houseId}>
          <option value="">Choose a house</option>{houses.data?.map((h) => <option key={h.id} value={h.id}>{h.title} ({h.vacant} vacant)</option>)}
        </SelectField>
        <Field label="Unit label" placeholder="B4" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} error={errs.unitLabel} />
        <Field label="Tenant name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
        <Field label="Tenant phone" type="tel" inputMode="tel" placeholder="0722 111 222" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} />
        <Field label="Emergency contact name" value={f.emergencyName} onChange={(e) => setF({ ...f, emergencyName: e.target.value })} error={errs.emergencyName} />
        <Field label="Emergency contact phone" type="tel" inputMode="tel" value={f.emergencyPhone} onChange={(e) => setF({ ...f, emergencyPhone: e.target.value })} error={errs.emergencyPhone} />
        <Field label="Relationship" placeholder="mother" value={f.emergencyRelationship} onChange={(e) => setF({ ...f, emergencyRelationship: e.target.value })} error={errs.emergencyRelationship} />
        <Field label="Rent per month (KES)" type="number" inputMode="numeric" value={f.rent} onChange={(e) => setF({ ...f, rent: e.target.value })} error={errs.rent} />
        <Field label="Deposit (KES)" type="number" inputMode="numeric" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} />
        <Field label="Rent due on day" type="number" inputMode="numeric" value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: e.target.value })} error={errs.dueDay} hint="1 to 28" />
      </div>
      <p className="text-sm text-graphite-400">Make sure you have the emergency contact's agreement to keep their number.</p>
      <ErrorNote error={add.error} />
      <div className="flex gap-2"><Button magnetic loading={add.isPending} onClick={submit}>Save tenant</Button><Button variant="ghost" onClick={onDone}>Cancel</Button></div>
    </Panel>
  );
}

function Detail({ t }: { t: TenancyRow }) {
  const update = useLiveMutation("landlord", (p: Parameters<typeof api.landlord.updateTenancy>[1]) => api.landlord.updateTenancy(t.id, p));
  const upload = useLiveMutation("landlord", (f: File) => api.landlord.uploadAgreement(t.id, f));
  const invite = useLiveMutation<void, InviteResult>("landlord", () => api.landlord.inviteTenant(t.id));
  const end = useLiveMutation("landlord", () => api.landlord.endTenancy(t.id));
  const [pb, setPb] = useState(t.kplcPaybill ?? "");
  const [mn, setMn] = useState(t.meterNumber ?? "");
  const [scan, setScan] = useState<File | null>(null);
  const [link, setLink] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [msg, setMsg] = useState<string>();

  const openAgreement = async () => { if (t.agreementPath) window.open(await api.landlord.fileUrl("agreements", t.agreementPath), "_blank", "noopener,noreferrer"); };
  const agreement = t.agreementPath ? "Signed copy uploaded" : t.agreementSignedOn ? "Signed on paper" : t.agreementPrintedOn ? "Printed" : "Not printed";

  return (
    <div className="grid gap-5 border-t border-white/8 p-5">
      <div className="grid gap-2 text-sm text-graphite-200 sm:grid-cols-2">
        <p>Phone: <span className="text-bone">{t.phone}</span></p>
        <p>Emergency: <span className="text-bone">{t.emergencyName} ({t.emergencyRelationship}) {t.emergencyPhone}</span></p>
        <p>Rent: <span className="text-bone">{formatKes(t.rent)}</span>, due on the {t.dueDay}th</p>
        <p>Payment code: <span className="font-mono text-bone">{t.code}</span></p>
      </div>

      {t.status !== "ended" && !t.joined && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={invite.isPending} onClick={() => invite.mutate(undefined, { onSuccess: setLink })}>Send login invite</Button>
            <span className="text-sm text-graphite-300">Texts a link to the tenant. Costs one SMS from your wallet.</span>
          </div>
          <ErrorNote error={invite.error} />
          {link && (
            <div className="rounded-xl border border-white/10 bg-white/4 p-3 text-sm">
              <p>{link.smsSent ? "Invite sent by SMS. You can also share this link:" : "The SMS could not be sent (check your SMS balance). Share this link yourself, for example on WhatsApp:"}</p>
              <p className="mt-1 break-all text-ember-300">{link.link}</p>
              <Button variant="glass" size="sm" className="mt-2" onClick={() => { void navigator.clipboard.writeText(link.link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 rounded-xl border border-white/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg">Tenancy agreement</h3><Chip tone={t.agreementPath || t.agreementSignedOn ? "ok" : "neutral"}>{agreement}</Chip></div>
        <p className="text-sm text-graphite-300">Print the day before entry, sign when the deposit is paid, and each keep a paper copy. Uploading a scan is optional and lets the tenant download it too.</p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/landlord/agreement/${t.id}`}><Button variant="glass" size="sm">Open printable agreement</Button></Link>
          {!t.agreementPrintedOn && <Button variant="ghost" size="sm" onClick={() => update.mutate({ agreementPrintedOn: todayIso() })}>Mark as printed</Button>}
          {!t.agreementSignedOn && <Button variant="ghost" size="sm" onClick={() => update.mutate({ agreementSignedOn: todayIso() })}>Mark as signed today</Button>}
          {t.agreementPath && <Button variant="ghost" size="sm" onClick={() => void openAgreement()}>Download scan</Button>}
        </div>
        {(t.agreementPrintedOn || t.agreementSignedOn) && <p className="text-sm text-graphite-400">{t.agreementPrintedOn && `Printed ${fmtDate(t.agreementPrintedOn)}. `}{t.agreementSignedOn && `Signed ${fmtDate(t.agreementSignedOn)}.`}</p>}
        <FileField label="Upload a scan of the signed copy (optional)" file={scan} onPick={setScan} />
        {scan && <div><Button size="sm" loading={upload.isPending} onClick={() => upload.mutate(scan, { onSuccess: () => { setScan(null); setMsg("Scan uploaded."); } })}>Upload scan</Button></div>}
        <ErrorNote error={upload.error} />
      </div>

      <div className="grid gap-3 rounded-xl border border-white/10 p-4">
        <div className="flex items-center justify-between gap-2"><h3 className="text-lg">Electricity tokens</h3>
          <Button variant={t.electricityEnabled ? "primary" : "glass"} size="sm" onClick={() => update.mutate({ electricityEnabled: !t.electricityEnabled })} disabled={!t.electricityEnabled && !(t.kplcPaybill && t.meterNumber)}>{t.electricityEnabled ? "Shown to tenant" : "Hidden from tenant"}</Button></div>
        <p className="text-sm text-graphite-300">Paste the KPLC paybill and this tenant's meter number. They pay KPLC in their own M-Pesa app. It is not part of the rent record.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="KPLC paybill" inputMode="numeric" value={pb} onChange={(e) => setPb(e.target.value.replace(/\D/g, ""))} />
          <Field label="Token meter number" inputMode="numeric" value={mn} onChange={(e) => setMn(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div><Button variant="glass" size="sm" loading={update.isPending} onClick={() => update.mutate({ kplcPaybill: pb || null, meterNumber: mn || null, electricityEnabled: Boolean(pb && mn) && t.electricityEnabled }, { onSuccess: () => setMsg("Electricity details saved.") })}>Save details</Button></div>
      </div>

      {msg && <p role="status" className="text-sm text-ok">{msg}</p>}
      <ErrorNote error={update.error ?? end.error} />
      {t.status !== "ended" && (confirmEnd
        ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-graphite-200">Move this tenant out? The unit becomes vacant again.</span><Button size="sm" loading={end.isPending} onClick={() => end.mutate()}>Yes, move out</Button><Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)}>Cancel</Button></div>
        : <div><Button variant="ghost" size="sm" onClick={() => setConfirmEnd(true)}>Move out</Button></div>)}
    </div>
  );
}

export default function Tenants() {
  const { data, isPending, error } = useLive("landlord", "tenants", () => api.landlord.tenants());
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const list = (data ?? []).filter((t) => showEnded || t.status !== "ended");

  return (
    <div className="grid gap-4">
      <PageHead title="Tenants" sub="Everyone renting from you, with their phone and emergency contact." action={!adding && <Button magnetic onClick={() => setAdding(true)}>Add a tenant</Button>} />
      {adding && <AddTenant onDone={() => setAdding(false)} />}
      <ErrorNote error={error} />
      {isPending && <div className="skeleton h-24" />}
      {data && list.length === 0 && !adding && <Panel className="p-4"><ToLet title="No tenants yet" note="Add a tenant when someone moves in. They get a login by SMS and pay rent with M-Pesa." /></Panel>}
      <Panel className="divide-y divide-white/8">
        {list.map((t) => (
          <div key={t.id}>
            <button className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-white/4" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
              <div><p className="text-lg font-medium">{t.name}</p><p className="text-sm text-graphite-300">{t.houseTitle} · unit {t.unit}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                {t.status === "ended" && <Chip>Moved out</Chip>}
                {t.status !== "ended" && (t.balance > 0 ? <Chip tone="danger">Owes {formatKes(t.balance)}</Chip> : <Chip tone="ok">Paid up</Chip>)}
                {t.status !== "ended" && <Chip tone={t.joined ? "ok" : "neutral"}>{t.joined ? "Has a login" : "Not joined"}</Chip>}
              </div>
            </button>
            {open === t.id && <Detail t={t} />}
          </div>
        ))}
      </Panel>
      {(data ?? []).some((t) => t.status === "ended") && <div><Button variant="ghost" size="sm" onClick={() => setShowEnded(!showEnded)}>{showEnded ? "Hide moved-out tenants" : "Show moved-out tenants"}</Button></div>}
    </div>
  );
}
