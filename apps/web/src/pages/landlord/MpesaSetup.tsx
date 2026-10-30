import { useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";

export default function MpesaSetup() {
  const acct = useLive("landlord", "account", () => api.landlord.paymentAccount());
  const connect = useLiveMutation("landlord", (v: Parameters<typeof api.landlord.connectDaraja>[0]) => api.landlord.connectDaraja(v));
  const mode = useLiveMutation("landlord", (m: "platform" | "own") => api.landlord.setPaymentMode(m));
  const [f, setF] = useState({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [result, setResult] = useState<string>();
  const a = acct.data;

  const submit = () => {
    const e: Record<string, string> = {};
    if (!/^\d{5,7}$/.test(f.shortcode)) e.shortcode = "Paybill number, 5 to 7 digits";
    if (f.consumerKey.trim().length < 10) e.consumerKey = "Paste your consumer key";
    if (f.consumerSecret.trim().length < 10) e.consumerSecret = "Paste your consumer secret";
    if (f.passkey.trim().length < 20) e.passkey = "Paste your passkey";
    setErrs(e);
    if (Object.keys(e).length) return;
    connect.mutate({ shortcode: f.shortcode, consumerKey: f.consumerKey.trim(), consumerSecret: f.consumerSecret.trim(), passkey: f.passkey.trim() }, {
      onSuccess: (r) => { setF({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" }); setShowForm(false); setResult(r.status === "connected" ? "Connected. You can now switch rent to your own Paybill below." : r.reason ?? "Safaricom did not accept these details."); },
      onError: () => { setF({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" }); setErrs({}); },
    });
  };

  return (
    <div className="grid gap-4">
      <PageHead title="M-Pesa setup" sub="Choose where your tenants' rent lands. Most landlords keep the platform Paybill: nothing to set up, and we pay you out." />
      <ErrorNote error={acct.error} />
      <Panel tone="hero" className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl">Where rent lands</h2>
          {a && <Chip tone="ok">{a.mode === "own" ? "Your own Paybill" : "Platform Paybill"}</Chip>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => mode.mutate("platform")} disabled={a?.mode === "platform" || mode.isPending} className={`rounded-xl border p-4 text-left ${a?.mode === "platform" ? "border-ember-400 bg-ember-500/10" : "border-white/10 hover:bg-white/5"}`}>
            <p className="font-medium">Platform Paybill</p><p className="mt-1 text-sm text-graphite-300">Rent lands with us, and we pay it out to the M-Pesa number or bank you choose on the Payments page.</p>
          </button>
          <button onClick={() => mode.mutate("own")} disabled={a?.mode === "own" || a?.status !== "connected" || mode.isPending} className={`rounded-xl border p-4 text-left disabled:cursor-not-allowed ${a?.mode === "own" ? "border-ember-400 bg-ember-500/10" : "border-white/10 hover:bg-white/5 disabled:opacity-50"}`}>
            <p className="font-medium">My own Paybill</p><p className="mt-1 text-sm text-graphite-300">Rent lands straight in your Paybill. Needs a Safaricom Daraja account with live approval for your Paybill.</p>
          </button>
        </div>
        <ErrorNote error={mode.error} />
      </Panel>

      <Panel className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl">Your Daraja connection</h2>
          {a && <Chip tone={a.status === "connected" ? "ok" : a.status === "failed" ? "danger" : "neutral"}>{a.status === "connected" ? `Connected, Paybill ${a.shortcode}` : a.status === "failed" ? "Failed" : "Not connected"}</Chip>}
        </div>
        {a?.failureReason && <p role="alert" className="text-sm text-danger">{a.failureReason}</p>}
        {result && <p role="status" className="text-sm text-graphite-200">{result}</p>}
        <p className="text-sm text-graphite-300">Your keys are tested with Safaricom, then stored encrypted. They are never shown again, not even to you. To change them, enter them again.</p>
        {!showForm ? <div><Button variant="glass" onClick={() => setShowForm(true)}>{a?.status === "connected" ? "Replace my details" : "Connect my Paybill"}</Button></div> : (
          <div className="grid gap-4">
            <Field label="Paybill number" inputMode="numeric" value={f.shortcode} onChange={(e) => setF({ ...f, shortcode: e.target.value.replace(/\D/g, "") })} error={errs.shortcode} />
            <Field label="Consumer key" autoComplete="off" value={f.consumerKey} onChange={(e) => setF({ ...f, consumerKey: e.target.value })} error={errs.consumerKey} />
            <Field label="Consumer secret" type="password" autoComplete="off" value={f.consumerSecret} onChange={(e) => setF({ ...f, consumerSecret: e.target.value })} error={errs.consumerSecret} />
            <Field label="Passkey" type="password" autoComplete="off" value={f.passkey} onChange={(e) => setF({ ...f, passkey: e.target.value })} error={errs.passkey} />
            <ErrorNote error={connect.error} />
            <div className="flex gap-2"><Button magnetic loading={connect.isPending} onClick={submit}>Test and connect</Button><Button variant="ghost" onClick={() => { setF({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" }); setErrs({}); setShowForm(false); }}>Cancel</Button></div>
          </div>
        )}
      </Panel>
    </div>
  );
}
