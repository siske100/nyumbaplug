import { useState } from "react";
import { kenyanPhone } from "@rh/shared";
import { api } from "@/api";
import type { InviteResult } from "@/api/types";
import { ToLet } from "@/components/motion/Doodles";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLandlordHouses } from "@/features/landlord/hooks";
import { useLive, useLiveMutation } from "@/features/live";

export default function Caretakers() {
  const list = useLive("landlord", "caretakers", () => api.landlord.caretakers());
  const houses = useLandlordHouses();
  const invite = useLiveMutation<{ houseId: string; name: string; phone: string }, InviteResult>("landlord", (v) => api.landlord.inviteCaretaker(v.houseId, v.name, v.phone));
  const remove = useLiveMutation("landlord", (v: { caretakerId: string; houseId: string }) => api.landlord.removeCaretaker(v.caretakerId, v.houseId));
  const [f, setF] = useState({ houseId: "", name: "", phone: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [link, setLink] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const send = () => {
    const p = kenyanPhone.safeParse(f.phone);
    const e: Record<string, string> = {};
    if (!f.houseId) e.houseId = "Choose a house";
    if (f.name.trim().length < 2) e.name = "Enter their name";
    if (!p.success) e.phone = p.error.issues[0]?.message ?? "Enter a valid phone number";
    setErrs(e);
    if (Object.keys(e).length || !p.success) return;
    invite.mutate({ houseId: f.houseId, name: f.name.trim(), phone: p.data }, { onSuccess: (r) => { setLink(r); setCopied(false); setF({ houseId: "", name: "", phone: "" }); } });
  };

  return (
    <div className="grid gap-4">
      <PageHead title="Caretakers" sub="A caretaker sees only the houses you give them, their tenants and complaints. Never payments or your subscription." />
      <Panel className="grid gap-4 p-5 sm:p-6">
        <h2 className="text-xl">Invite a caretaker</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="House" value={f.houseId} onChange={(e) => setF({ ...f, houseId: e.target.value })} error={errs.houseId}><option value="">Choose a house</option>{houses.data?.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}</SelectField>
          <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
          <Field label="Phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} />
        </div>
        <ErrorNote error={invite.error} />
        <div><Button magnetic loading={invite.isPending} onClick={send}>Send invite</Button></div>
        {link && (
          <div className="rounded-xl border border-white/10 bg-white/4 p-3 text-sm">
            <p>{link.smsSent ? "Invite sent by SMS. You can also share this link:" : "The SMS could not be sent. Share this link yourself, for example on WhatsApp:"}</p>
            <p className="mt-1 break-all text-ember-300">{link.link}</p>
            <Button variant="glass" size="sm" className="mt-2" onClick={() => { void navigator.clipboard.writeText(link.link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
        )}
      </Panel>
      <ErrorNote error={list.error ?? remove.error} />
      {list.data?.length === 0 && <Panel className="p-4"><ToLet title="No caretakers yet" note="Invite someone you trust to handle complaints and visits at a house." /></Panel>}
      <Panel className="divide-y divide-white/8">
        {list.data?.map((c) => (
          <div key={c.caretakerId + c.houseId} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div><p className="font-medium">{c.name}</p><p className="text-sm text-graphite-300">{c.phone} · {c.houseTitle}</p></div>
            <Button variant="ghost" size="sm" loading={remove.isPending} onClick={() => remove.mutate({ caretakerId: c.caretakerId, houseId: c.houseId })}>Remove from this house</Button>
          </div>
        ))}
      </Panel>
    </div>
  );
}
