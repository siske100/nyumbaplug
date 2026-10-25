import { useState } from "react";
import { smsCost, SMS_PRICE_KES } from "@rh/shared";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { Stats } from "@/components/ui/Stats";
import { useLandlordHouses } from "@/features/landlord/hooks";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

const TRIGGERS: [string, string][] = [["7d", "1 week before"], ["4d", "4 days before"], ["2d", "2 days before"], ["1d", "1 day before"], ["due", "On the due date"], ["overdue", "Overdue notice"]];
const STATUS_TONE: Record<string, "ok" | "danger" | "ember" | "neutral"> = { delivered: "ok", sent: "ok", failed: "danger", paused_insufficient_balance: "danger", queued: "ember" };

export default function Sms() {
  const pending = (r: { status: string; at: string } | null | undefined) => r?.status === "pending" && Date.now() - new Date(r.at).getTime() < 5 * 60_000;
  const sms = useLive("landlord", "sms", () => api.landlord.sms(), { refetchInterval: 5_000 });
  const tenants = useLive("landlord", "tenants", () => api.landlord.tenants());
  const houses = useLandlordHouses();
  const recharge = useLiveMutation("landlord", (amount: number) => api.landlord.pay("sms_recharge", amount));
  const save = useLiveMutation("landlord", (t: string[]) => api.landlord.saveReminderTriggers(t));
  const send = useLiveMutation("landlord", (v: { scope: "all" | "house" | "tenancy"; target: string | null; message: string }) => api.landlord.broadcast(v.scope, v.target, v.message));
  const [amount, setAmount] = useState(500);
  const [triggers, setTriggers] = useState<string[] | null>(null);
  const [scope, setScope] = useState<"all" | "house" | "tenancy">("all");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string>();
  const [err, setErr] = useState<string>();

  const data = sms.data;
  const active = (tenants.data ?? []).filter((t) => t.status !== "ended");
  const recipients = scope === "all" ? active.length : scope === "house" ? active.filter((t) => t.houseId === target).length : target ? 1 : 0;
  const cost = smsCost(message, recipients);
  const shown = triggers ?? data?.triggers ?? [];
  const low = (data?.balance ?? 0) < 16;

  const doSend = () => {
    if (!message.trim()) return setErr("Write a message first.");
    if (scope !== "all" && !target) return setErr("Choose who to send to.");
    if (cost > (data?.balance ?? 0)) return setErr("Not enough SMS balance. Recharge to resume sending.");
    setErr(undefined);
    send.mutate({ scope, target: scope === "all" ? null : target, message }, { onSuccess: (r) => { setMessage(""); setNotice(`Sent to ${r.sent}${r.failed ? `, ${r.failed} failed (refunded)` : ""}${r.paused ? `, ${r.skipped} not sent because your balance ran out` : ""}.`); } });
  };

  return (
    <div className="grid gap-4">
      <PageHead title="SMS wallet" sub={`Each SMS costs KES ${SMS_PRICE_KES.toFixed(2)} a segment. When the balance reaches zero, sending stops until you recharge.`} />
      <ErrorNote error={sms.error} />
      {low && data && <Panel className="border-ember-500/40 p-4"><p className="font-medium">{data.balance <= 0 ? "SMS paused. Recharge to resume." : "SMS balance is low."}</p><p className="text-sm text-graphite-300">Rent reminders and payment receipts to your tenants stop at zero.</p></Panel>}
      <Stats loading={sms.isPending} items={[{ label: "Balance", value: formatKes(Math.round((data?.balance ?? 0) * 100) / 100), note: `about ${Math.floor((data?.balance ?? 0) / SMS_PRICE_KES)} SMS`, tone: low ? "warn" : "ok" }, { label: "Messages", value: String(data?.messages.length ?? 0), note: "recent" }, { label: "Reminders", value: String(shown.length), note: "per tenant each month" }, { label: "Tenants", value: String(active.length) }]} />

      <Panel className="grid gap-4 p-5 sm:p-6">
        <h2 className="text-xl">Recharge by M-Pesa</h2>
        <div className="flex flex-wrap gap-2">{[100, 500, 1000, 2000].map((a) => <Button key={a} variant={amount === a ? "primary" : "glass"} size="sm" onClick={() => setAmount(a)}>KES {a}</Button>)}</div>
        <ErrorNote error={recharge.error} />
        {recharge.data && <p role="status" className="text-sm text-ok">{recharge.data.message} Your balance updates when M-Pesa confirms.</p>}
        {pending(data?.lastRecharge) && <p role="status" className="text-sm text-ember-300">Waiting for your M-Pesa confirmation of KES {data?.lastRecharge?.amount}...</p>}
        <div><Button magnetic loading={recharge.isPending} onClick={() => recharge.mutate(amount)}>Pay KES {amount} with M-Pesa</Button></div>
      </Panel>

      <Panel className="grid gap-3 p-5 sm:p-6">
        <h2 className="text-xl">Rent reminders</h2>
        <p className="text-sm text-graphite-300">Choose when tenants who still owe get a text. If you choose nothing, they get one 2 days before and one on the due date.</p>
        <div className="flex flex-wrap gap-2">{TRIGGERS.map(([k, label]) => <Button key={k} variant={shown.includes(k) ? "primary" : "glass"} size="sm" onClick={() => setTriggers(shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k])}>{label}</Button>)}</div>
        <ErrorNote error={save.error} />
        {triggers && <div><Button size="sm" loading={save.isPending} onClick={() => save.mutate(triggers, { onSuccess: () => setTriggers(null) })}>Save reminders</Button></div>}
      </Panel>

      <Panel className="grid gap-4 p-5 sm:p-6">
        <h2 className="text-xl">Send a message</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="To" value={scope} onChange={(e) => { setScope(e.target.value as typeof scope); setTarget(""); }}><option value="all">All my tenants</option><option value="house">One house</option><option value="tenancy">One tenant</option></SelectField>
          {scope === "house" && <SelectField label="House" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a house</option>{houses.data?.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}</SelectField>}
          {scope === "tenancy" && <SelectField label="Tenant" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a tenant</option>{active.map((t) => <option key={t.id} value={t.id}>{t.name} (unit {t.unit})</option>)}</SelectField>}
        </div>
        <div>
          <label htmlFor="sms" className="mb-1.5 block text-sm text-graphite-200">Message</label>
          <textarea id="sms" rows={3} maxLength={480} value={message} onChange={(e) => { setMessage(e.target.value); setErr(undefined); }} placeholder="Water will be off tomorrow 9am to 1pm." className="w-full rounded-[10px] border border-white/10 bg-graphite-900/60 px-3.5 py-2.5 focus:border-ember-400/70 focus:outline-none" />
          <p className="mt-1.5 text-sm text-graphite-300">{message.length} characters · {recipients} {recipients === 1 ? "person" : "people"} · KES {cost.toFixed(2)}</p>
        </div>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <ErrorNote error={send.error} />
        {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
        <div><Button magnetic loading={send.isPending} onClick={doSend}>Send</Button></div>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <h2 className="text-xl">History</h2>
        <ul className="mt-3 divide-y divide-white/8">
          {data?.messages.length === 0 && <li className="py-3 text-graphite-300">No messages yet.</li>}
          {data?.messages.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0"><p className="truncate">{m.body}</p><p className="text-sm text-graphite-400">{m.recipient} · {fmtDate(m.at)} · {m.segments} segment{m.segments === 1 ? "" : "s"}</p></div><div className="flex items-center gap-2"><span className="text-sm">KES {m.cost.toFixed(2)}</span><Chip tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status === "paused_insufficient_balance" ? "not sent: no balance" : m.status}</Chip></div></li>)}
        </ul>
      </Panel>
    </div>
  );
}
