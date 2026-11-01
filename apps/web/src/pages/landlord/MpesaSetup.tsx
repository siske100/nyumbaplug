import { useEffect, useState } from "react";
import { api } from "@/api";
import type { PaymentMode } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";

const blankDaraja = { shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" };

export default function MpesaSetup() {
  const acct = useLive("landlord", "account", () => api.landlord.paymentAccount());
  const bankSetup = useLive("landlord", "bank-payment-setup", () => api.landlord.bankPaymentSetup());
  const connect = useLiveMutation("landlord", (v: Parameters<typeof api.landlord.connectDaraja>[0]) => api.landlord.connectDaraja(v));
  const saveBank = useLiveMutation("landlord", (v: { bankId: number; accountNumber: string | null }) => api.landlord.saveBankPaymentAccount(v.bankId, v.accountNumber));
  const removeBank = useLiveMutation("landlord", () => api.landlord.removeBankPaymentAccount());
  const startBankTest = useLiveMutation("landlord", () => api.landlord.startBankPaymentTest());
  const confirmBankTest = useLiveMutation("landlord", () => api.landlord.confirmBankPaymentTest());
  const mode = useLiveMutation("landlord", (m: PaymentMode) => api.landlord.setPaymentMode(m));
  const [daraja, setDaraja] = useState(blankDaraja);
  const [bankId, setBankId] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [showDarajaForm, setShowDarajaForm] = useState(false);
  const [confirmRemoveBank, setConfirmRemoveBank] = useState(false);
  const [result, setResult] = useState<string>();
  const [bankResult, setBankResult] = useState<string>();
  const a = acct.data;
  const bankAccount = bankSetup.data?.account ?? null;
  const savedTest = bankSetup.data?.latestTest ?? null;
  const selectedBank = bankSetup.data?.banks.find((bank) => String(bank.id) === bankId);
  const latestTest = bankAccount && selectedBank && savedTest?.bankId === bankAccount.bankId
    && savedTest.accountNumber === bankAccount.accountNumber && savedTest.paybill === selectedBank.paybill
    ? savedTest : null;
  const bankModeReady = !!bankAccount?.verified && !!bankSetup.data?.banks.some((bank) => bank.id === bankAccount.bankId);

  useEffect(() => {
    const saved = bankSetup.data?.account;
    setBankId(saved ? String(saved.bankId) : "");
    setBankAccountNumber(saved?.accountNumber ?? "");
  }, [bankSetup.data?.account?.bankId, bankSetup.data?.account?.accountNumber]);

  useEffect(() => {
    if (latestTest?.status !== "pending") return;
    const timer = window.setInterval(() => { void bankSetup.refetch(); }, 2500);
    return () => window.clearInterval(timer);
  }, [latestTest?.status, bankSetup.refetch]);

  const submitDaraja = () => {
    const e: Record<string, string> = {};
    if (!/^\d{5,7}$/.test(daraja.shortcode)) e.shortcode = "Paybill number, 5 to 7 digits";
    if (daraja.consumerKey.trim().length < 10) e.consumerKey = "Paste your consumer key";
    if (daraja.consumerSecret.trim().length < 10) e.consumerSecret = "Paste your consumer secret";
    if (daraja.passkey.trim().length < 20) e.passkey = "Paste your passkey";
    setErrs(e);
    if (Object.keys(e).length) return;
    connect.mutate({ shortcode: daraja.shortcode, consumerKey: daraja.consumerKey.trim(), consumerSecret: daraja.consumerSecret.trim(), passkey: daraja.passkey.trim() }, {
      onSuccess: (r) => {
        setDaraja(blankDaraja);
        setShowDarajaForm(false);
        setResult(r.status === "connected" ? "Daraja connected. Choose your own Paybill above to send rent there." : r.reason ?? "Safaricom did not accept these details.");
      },
      onError: () => { setDaraja(blankDaraja); setErrs({}); },
    });
  };

  const submitBankAccount = () => {
    const selected = Number(bankId);
    if (!Number.isSafeInteger(selected) || selected <= 0) {
      setErrs({ bankId: "Select a receiving bank" });
      return;
    }
    const saved = bankSetup.data?.account;
    if (saved && saved.bankId !== selected) {
      setErrs({});
      saveBank.mutate({ bankId: selected, accountNumber: null }, {
        onSuccess: (status) => {
          setBankAccountNumber("");
          setBankResult(status === "reenter_account_number" ? "Bank changed. Enter and save the bank account number again before confirming a new test payment." : "Bank account saved.");
        },
      });
      return;
    }
    if (!/^\d{1,40}$/.test(bankAccountNumber)) {
      setErrs({ bankAccountNumber: "Enter 1 to 40 digits" });
      return;
    }
    const alreadyVerified = bankAccount?.bankId === selected
      && bankAccount.accountNumber === bankAccountNumber
      && bankAccount.verified;
    setErrs({});
    saveBank.mutate({ bankId: selected, accountNumber: bankAccountNumber }, {
      onSuccess: (status) => setBankResult(status === "reenter_account_number"
        ? "Bank changed. Enter and save the bank account number again."
        : alreadyVerified
          ? "These bank details are unchanged and remain test-confirmed."
          : "Bank account saved. Send the verified KES 10 test payment below to enable this route."),
    });
  };

  const modeCard = (value: PaymentMode, title: string, detail: string, unavailable: boolean, unavailableText = "Connect this account below to enable it.") => (
    <button
      key={value}
      type="button"
      aria-pressed={a?.mode === value}
      onClick={() => mode.mutate(value)}
      disabled={!a || a.mode === value || unavailable || mode.isPending}
      className={`rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${a?.mode === value ? "border-ember-400 bg-ember-500/10" : "border-white/10 hover:bg-white/5"}`}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm leading-5 text-graphite-300">{detail}</p>
      {unavailable && <p className="mt-2 text-xs text-graphite-400">{unavailableText}</p>}
    </button>
  );

  return (
    <div className="grid gap-4">
      <PageHead title="Payment setup" sub="Choose how tenants pay rent. Direct options settle to the merchant account you connect; the platform Paybill remains available if you prefer managed payouts." />
      <ErrorNote error={acct.error} />
      <Panel tone="hero" className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-2xl">Where tenants pay</h2>
          {a && <Chip tone="ok">{a.mode === "own" ? "Your Daraja Paybill" : a.mode === "bank_paybill" ? "Bank Paybill" : "Platform Paybill"}</Chip>}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {modeCard("own", "My Daraja Paybill", "Tenants pay through an M-Pesa prompt. Funds go to the Paybill connected with your Daraja credentials.", a?.status !== "connected")}
          {modeCard("bank_paybill", "Bank Paybill", "Tenants receive an M-Pesa prompt addressed to your selected bank Paybill and account number.", !bankModeReady, "Save your bank details and complete the verified KES 10 test payment below.")}
          {modeCard("platform", "Platform Paybill", "Rent goes to the platform Paybill and is paid out to your saved payout destination.", false)}
        </div>
        <ErrorNote error={mode.error} />
      </Panel>

      <Panel className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl">Bank Paybill account</h2>
          {bankAccount && <Chip tone={bankAccount.verified ? "ok" : "neutral"}>{bankAccount.verified ? "Test payment confirmed" : latestTest?.status === "pending" ? "Waiting for M-Pesa" : "Test payment required"}</Chip>}
        </div>
        <p className="text-sm text-graphite-300">Use a business bank account registered to your business, not a personal account. Bank settlement is not instant; timing depends on the bank.</p>
        {bankSetup.data?.banks.length === 0 && <p role="status" className="text-sm text-graphite-300">No receiving banks are configured yet. Bank options will appear after official bank Paybill details are added.</p>}
        <ErrorNote error={bankSetup.error} />
        <SelectField
          label="Receiving bank"
          value={bankId}
          error={errs.bankId}
          disabled={!bankSetup.data?.banks.length || saveBank.isPending}
          onChange={(event) => {
            const value = event.target.value;
            setBankId(value);
            if (value !== bankId) setBankAccountNumber("");
            setErrs({});
          }}
        >
          <option value="">Select a bank...</option>
          {(bankSetup.data?.banks ?? []).map((bank) => <option key={bank.id} value={bank.id}>{bank.name} · Paybill {bank.paybill}</option>)}
        </SelectField>
        <Field
          label="Bank account number"
          inputMode="numeric"
          autoComplete="off"
          maxLength={40}
          value={bankAccountNumber}
          onChange={(event) => setBankAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 40))}
          error={errs.bankAccountNumber}
          hint="Digits only, up to 40. Changing banks clears this number and requires it to be entered again."
        />
        <ErrorNote error={saveBank.error} />
        <div><Button loading={saveBank.isPending} disabled={!selectedBank} onClick={submitBankAccount}>Save bank details</Button></div>
        {bankResult && <p role="status" className="text-sm text-graphite-200">{bankResult}</p>}
        {bankAccount?.accountNumber && (
          <div className="grid gap-2">
            {!confirmRemoveBank ? (
              <div>
                <Button variant="ghost" disabled={removeBank.isPending || saveBank.isPending} onClick={() => setConfirmRemoveBank(true)}>
                  Remove saved bank account
                </Button>
              </div>
            ) : (
              <div className="grid gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
                <p className="text-sm text-graphite-200">
                  Remove the saved account number and verification? Bank Paybill will switch to Platform Paybill.
                  Safaricom test-payment history will be kept.
                </p>
                <ErrorNote error={removeBank.error} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="glass"
                    loading={removeBank.isPending}
                    onClick={() => removeBank.mutate(undefined, {
                      onSuccess: () => {
                        setBankAccountNumber("");
                        setConfirmRemoveBank(false);
                        setBankResult("Bank account removed. Add replacement bank details below.");
                      },
                    })}
                  >
                    Confirm removal
                  </Button>
                  <Button variant="ghost" disabled={removeBank.isPending} onClick={() => setConfirmRemoveBank(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {bankAccount?.accountNumber && !bankAccount.verified && selectedBank
          && bankAccount.bankId === selectedBank.id && bankAccount.accountNumber === bankAccountNumber && (
          <div className="grid gap-3 rounded-xl border border-ember-400/25 bg-ember-500/5 p-4">
            <p className="text-sm text-graphite-200">
              Send a KES 10 test payment to <strong>{selectedBank.name} Paybill {selectedBank.paybill}</strong>,
              using account number <strong>{bankAccount.accountNumber}</strong>. We will send the M-Pesa prompt to your verified phone.
              After Safaricom confirms the payment, confirm that it reached your bank account.
            </p>
            {latestTest?.status === "pending" && <p role="status" className="text-sm text-graphite-200">Prompt sent. Complete it on your phone; waiting for Safaricom's confirmation.</p>}
            {latestTest?.status === "succeeded" && (
              <p role="status" className="text-sm text-graphite-200">
                Safaricom confirmed KES 10{latestTest.mpesaReceipt ? ` (receipt ${latestTest.mpesaReceipt})` : ""}.
                Confirm only after the funds arrive in your bank account.
              </p>
            )}
            {latestTest?.status === "failed" && <p role="alert" className="text-sm text-danger">Safaricom did not confirm the test payment. You can send another test payment.</p>}
            <ErrorNote error={startBankTest.error} />
            <ErrorNote error={confirmBankTest.error} />
            <div>
              {latestTest?.status === "succeeded"
                ? <Button variant="glass" loading={confirmBankTest.isPending} onClick={() => confirmBankTest.mutate()}>I received KES 10 in my bank account</Button>
                : <Button variant="glass" loading={startBankTest.isPending} disabled={latestTest?.status === "pending"} onClick={() => startBankTest.mutate()}>Send test payment</Button>}
            </div>
          </div>
        )}
        {bankAccount?.verified && bankAccount.testPaymentReceipt && (
          <p className="text-sm text-graphite-300">Confirmed test receipt: {bankAccount.testPaymentReceipt}</p>
        )}
      </Panel>

      <Panel className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl">Your Daraja connection</h2>
          {a && <Chip tone={a.status === "connected" ? "ok" : a.status === "failed" ? "danger" : "neutral"}>{a.status === "connected" ? `Connected, Paybill ${a.shortcode}` : a.status === "failed" ? "Failed" : "Not connected"}</Chip>}
        </div>
        {a?.failureReason && <p role="alert" className="text-sm text-danger">{a.failureReason}</p>}
        {result && <p role="status" className="text-sm text-graphite-200">{result}</p>}
        <p className="text-sm text-graphite-300">Daraja credentials are tested and stored encrypted on the server. They are never returned to the browser.</p>
        {!showDarajaForm ? <div><Button variant="glass" onClick={() => setShowDarajaForm(true)}>{a?.status === "connected" ? "Replace Daraja details" : "Connect Daraja Paybill"}</Button></div> : (
          <div className="grid gap-4">
            <Field label="Paybill number" inputMode="numeric" value={daraja.shortcode} onChange={(e) => setDaraja({ ...daraja, shortcode: e.target.value.replace(/\D/g, "") })} error={errs.shortcode} />
            <Field label="Consumer key" autoComplete="off" value={daraja.consumerKey} onChange={(e) => setDaraja({ ...daraja, consumerKey: e.target.value })} error={errs.consumerKey} />
            <Field label="Consumer secret" type="password" autoComplete="off" value={daraja.consumerSecret} onChange={(e) => setDaraja({ ...daraja, consumerSecret: e.target.value })} error={errs.consumerSecret} />
            <Field label="Passkey" type="password" autoComplete="off" value={daraja.passkey} onChange={(e) => setDaraja({ ...daraja, passkey: e.target.value })} error={errs.passkey} />
            <ErrorNote error={connect.error} />
            <div className="flex gap-2">
              <Button magnetic loading={connect.isPending} onClick={submitDaraja}>Test and connect</Button>
              <Button variant="ghost" onClick={() => { setDaraja(blankDaraja); setErrs({}); setShowDarajaForm(false); }}>Cancel</Button>
            </div>
          </div>
        )}
      </Panel>

    </div>
  );
}
