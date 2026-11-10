import { Building2, Landmark, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";

const blankDaraja = { shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" };

export default function MpesaSetup({ embedded = false }: { embedded?: boolean }) {
  const acct = useLive("landlord", "account", () => api.landlord.paymentAccount());
  const bankSetup = useLive("landlord", "bank-payment-setup", () => api.landlord.bankPaymentSetup());
  const connect = useLiveMutation("landlord", (v: Parameters<typeof api.landlord.connectDaraja>[0]) => api.landlord.connectDaraja(v));
  const saveManual = useLiveMutation("landlord", (v: { bankId: number; accountNumber: string; accountName: string }) =>
    api.landlord.saveManualBankAccount(v.bankId, v.accountNumber, v.accountName));
  const setMode = useLiveMutation("landlord", (mode: "own" | "bank_paybill") => api.landlord.setPaymentMode(mode));
  const [daraja, setDaraja] = useState(blankDaraja);
  const [bankId, setBankId] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [result, setResult] = useState<string>();
  const a = acct.data;
  const bank = bankSetup.data;
  const manualConfigured = !!bank?.account?.accountNumber && !!bank.account.accountName;
  const manualSelected = a?.mode === "bank_paybill";

  useEffect(() => {
    if (!bank?.account) return;
    setBankId(String(bank.account.bankId));
    setAccountNumber(bank.account.accountNumber ?? "");
    setAccountName(bank.account.accountName ?? "");
  }, [bank?.account]);

  const submit = () => {
    const e: Record<string, string> = {};
    if (!/^\d{5,7}$/.test(daraja.shortcode)) e.shortcode = "Paybill number, 5 to 7 digits";
    if (daraja.consumerKey.trim().length < 10) e.consumerKey = "Paste your consumer key";
    if (daraja.consumerSecret.trim().length < 10) e.consumerSecret = "Paste your consumer secret";
    if (daraja.passkey.trim().length < 20) e.passkey = "Paste your passkey";
    setErrs(e);
    if (Object.keys(e).length) return;
    connect.mutate({
      shortcode: daraja.shortcode,
      consumerKey: daraja.consumerKey.trim(),
      consumerSecret: daraja.consumerSecret.trim(),
      passkey: daraja.passkey.trim(),
    }, {
      onSuccess: (r) => {
        setDaraja(blankDaraja);
        setShowForm(false);
        setResult(r.status === "connected"
          ? "Daraja verified. Rent will now settle directly to this Paybill."
          : r.reason ?? "Safaricom did not accept these details.");
        void acct.refetch();
      },
      onError: () => { setDaraja(blankDaraja); setErrs({}); },
    });
  };

  const saveManualAccount = () => {
    const errors: Record<string, string> = {};
    if (!bankId) errors.bank = "Choose your bank";
    if (!/^\d{1,40}$/.test(accountNumber)) errors.accountNumber = "Enter an account number containing 1 to 40 digits";
    if (accountName.trim().length < 2 || accountName.trim().length > 120) errors.accountName = "Enter the account holder name";
    setManualErrors(errors);
    if (Object.keys(errors).length) return;
    saveManual.mutate({ bankId: Number(bankId), accountNumber, accountName: accountName.trim() });
  };

  return (
    <div id="payment-setup" className="grid gap-4">
      {!embedded && <PageHead title="Direct rent payment setup" sub="Connect your own verified Daraja Paybill. Rent settles directly to your merchant account; HousePlug Kenya never collects or holds rent." />}
      <ErrorNote error={acct.error} />
      <Panel tone="hero" className="landlord-payment-account grid gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-900 sm:size-11"><ShieldCheck className="size-6" aria-hidden /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Your rent receiving account</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">Connect a verified Paybill or securely save your direct bank details.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {a && <Chip tone={a.status === "connected" && a.mode === "own" ? "ok" : a.status === "failed" ? "danger" : "neutral"}>
              {a.status === "connected" && a.mode === "own" ? `Verified · Paybill ${a.shortcode}` : a.status === "failed" ? "Connection failed" : "Not connected"}
            </Chip>}
            {!showForm && <Button size="sm" onClick={() => setShowForm(true)}>{a?.status === "connected" ? "Replace Paybill" : "Connect Paybill"}</Button>}
          </div>
        </div>
        {a?.failureReason && <p role="alert" className="text-sm text-danger">{a.failureReason}</p>}
        {result && <p role="status" className="text-sm text-graphite-200">{result}</p>}
        <p className="text-sm text-graphite-300">Enter credentials issued for your own Paybill by Safaricom. HousePlug Kenya tests the connection and stores the credentials encrypted on the server. They are never returned to the browser.</p>
        {showForm && (
          <div className="grid gap-4">
            <Field label="Paybill number" inputMode="numeric" value={daraja.shortcode} onChange={(e) => setDaraja({ ...daraja, shortcode: e.target.value.replace(/\D/g, "") })} error={errs.shortcode} />
            <Field label="Consumer key" autoComplete="off" value={daraja.consumerKey} onChange={(e) => setDaraja({ ...daraja, consumerKey: e.target.value })} error={errs.consumerKey} />
            <Field label="Consumer secret" type="password" autoComplete="off" value={daraja.consumerSecret} onChange={(e) => setDaraja({ ...daraja, consumerSecret: e.target.value })} error={errs.consumerSecret} />
            <Field label="Passkey" type="password" autoComplete="off" value={daraja.passkey} onChange={(e) => setDaraja({ ...daraja, passkey: e.target.value })} error={errs.passkey} />
            <ErrorNote error={connect.error} />
            <div className="flex gap-2">
              <Button magnetic loading={connect.isPending} onClick={submit}>Test and connect</Button>
              <Button variant="ghost" onClick={() => { setDaraja(blankDaraja); setErrs({}); setShowForm(false); }}>Cancel</Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel className="grid gap-4 p-3.5 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-900"><Smartphone className="size-5" aria-hidden /></span>
          <div>
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Choose the rent payment method</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">Tenants can use only the methods selected here. Rent goes directly to your account.</p>
          </div>
        </div>
        <ErrorNote error={bankSetup.error} />
        <ErrorNote error={saveManual.error} />
        <ErrorNote error={setMode.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`landlord-payment-method grid content-start gap-3 rounded-xl border p-4 ${a?.mode === "own" ? "is-selected" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Smartphone className="size-6" aria-hidden /></span>
              {a?.mode === "own" && <Chip tone="ok">Selected</Chip>}
            </div>
            <div><h3 className="font-bold text-slate-900">M-Pesa Paybill</h3>
            <p className="text-sm text-graphite-300">Tenants receive an M-Pesa STK prompt. Funds settle to your connected Paybill.</p>
            </div>
            <Button variant="glass" disabled={a?.status !== "connected" || a.mode === "own"} loading={setMode.isPending} onClick={() => setMode.mutate("own")}>
              {a?.mode === "own" ? "Currently selected" : a?.status === "connected" ? "Use Daraja" : "Connect Daraja first"}
            </Button>
          </div>
          <div className={`landlord-payment-method grid content-start gap-3 rounded-xl border p-4 ${manualSelected ? "is-selected" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Landmark className="size-6" aria-hidden /></span>
              {manualSelected && <Chip tone="ok">Selected</Chip>}
            </div>
            <div><h3 className="font-bold text-slate-900">Bank transfer</h3>
            <p className="text-sm text-graphite-300">Tenants transfer directly to your account and submit the transfer message. You review it and mark funds received before rent is recorded.</p>
            </div>
            <Button variant="glass" disabled={!manualConfigured || manualSelected} loading={setMode.isPending} onClick={() => setMode.mutate("bank_paybill")}>
              {manualSelected ? "Currently selected" : manualConfigured ? "Use manual bank transfer" : "Save bank details first"}
            </Button>
          </div>
        </div>
        <div className="landlord-bank-details grid gap-4 rounded-xl border p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-900"><Building2 className="size-5" aria-hidden /></span>
            <div>
              <h3 className="font-bold text-slate-900">Your bank details</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">Shown only to your active tenants when bank transfer is selected. Details cannot be changed while a claim is awaiting review.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Bank" value={bankId} onChange={(e) => setBankId(e.target.value)} error={manualErrors.bank}>
            <option value="">Choose a bank</option>{bank?.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </SelectField>
          <Field label="Account holder name" value={accountName} maxLength={120} onChange={(e) => setAccountName(e.target.value)} error={manualErrors.accountName} />
          <Field label="Receiving account number" value={accountNumber} inputMode="numeric" maxLength={40} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))} error={manualErrors.accountNumber} />
          <div className="flex items-end"><Button className="w-full sm:w-auto" loading={saveManual.isPending} onClick={saveManualAccount}>Save bank details</Button></div>
          </div>
        </div>
      </Panel>
      <Panel className="landlord-bank-coming-soon flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg">Direct bank payment</h2>
          <Chip>Coming soon</Chip>
        </div>
      </Panel>
    </div>
  );
}
