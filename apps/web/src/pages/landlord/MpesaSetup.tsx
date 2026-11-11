import { Landmark, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api";
import type { DarajaInput, PaymentMode, PaymentsOverview } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Field, SelectField } from "@/components/ui/Field";
import { ErrorNote, PageHead } from "@/components/ui/PageHead";
import { Panel } from "@/components/ui/Panel";
import { useLive, useLiveMutation } from "@/features/live";
import { fmtDate, formatKes } from "@/lib/format";

type DestinationKind = "mpesa_phone" | "till" | "paybill";
type DestinationInput = { kind: DestinationKind; destination: string; accountRef: string | null };
type ManualBankInput = { bankId: number; accountNumber: string; accountName: string };

export default function MpesaSetup({ embedded = false }: { embedded?: boolean }) {
  const acct = useLive("landlord", "account", () => api.landlord.paymentAccount());
  const payments = useLive<PaymentsOverview>("landlord", "payments", () => api.landlord.payments());
  const payout = useLive("landlord", "payout-summary", () => api.landlord.payoutSummary());
  const bankSetup = useLive("landlord", "bank-payment-setup", () => api.landlord.bankPaymentSetup());
  const saveDestination = useLiveMutation("landlord", (v: DestinationInput) =>
    api.landlord.savePayoutDestination(v.kind, v.destination, v.accountRef));
  const saveManual = useLiveMutation("landlord", (v: ManualBankInput) =>
    api.landlord.saveManualBankAccount(v.bankId, v.accountNumber, v.accountName));
  const setMode = useLiveMutation("landlord", (mode: PaymentMode) => api.landlord.setPaymentMode(mode));
  const connectDaraja = useLiveMutation("landlord", async (input: DarajaInput) => {
    const result = await api.landlord.connectDaraja(input);
    if (result.status === "connected") await api.landlord.setPaymentMode("own");
    return result;
  });
  const requestPayout = useLiveMutation("landlord", () => api.landlord.requestPayout());
  const [destinationKind, setDestinationKind] = useState<DestinationKind>("mpesa_phone");
  const [destination, setDestination] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [destinationErrors, setDestinationErrors] = useState<Record<string, string>>({});
  const [bankId, setBankId] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({});
  const [darajaInput, setDarajaInput] = useState<DarajaInput>({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" });
  const [notice, setNotice] = useState<string>();

  const a = acct.data;
  const bank = bankSetup.data;
  const currentMode = a?.mode;
  const platformSelected = currentMode === "platform";
  const ownSelected = currentMode === "own";
  const manualSelected = currentMode === "bank_paybill";
  const destinationReady = !!payments.data?.destination;
  const manualConfigured = !!bank?.account?.accountNumber && !!bank.account.accountName;
  const payoutSummary = payout.data;
  const payoutOpensAt = payoutSummary?.opensAt ? new Date(payoutSummary.opensAt) : null;
  const payoutOpen = !payoutOpensAt || payoutOpensAt.getTime() <= Date.now();

  useEffect(() => {
    const saved = payments.data?.destination;
    if (!saved) return;
    setDestinationKind(saved.kind);
    setDestination(saved.destination);
    setAccountRef(saved.accountRef ?? "");
  }, [payments.data?.destination]);

  useEffect(() => {
    const saved = bank?.account;
    if (!saved) return;
    setBankId(String(saved.bankId));
    setAccountNumber(saved.accountNumber ?? "");
    setAccountName(saved.accountName ?? "");
  }, [bank?.account]);

  const savePayoutDestination = () => {
    const errors: Record<string, string> = {};
    if (destinationKind === "mpesa_phone" && !/^(07|01)\d{8}$/.test(destination)) {
      errors.destination = "Enter a valid Kenyan M-Pesa phone number";
    } else if (destinationKind !== "mpesa_phone" && !/^\d{5,7}$/.test(destination)) {
      errors.destination = "Enter a 5 to 7 digit Till or Paybill number";
    }
    if (destinationKind === "paybill" && !/^[A-Za-z0-9 ._-]{1,40}$/.test(accountRef.trim())) {
      errors.accountRef = "Enter the account reference used for this Paybill";
    }
    setDestinationErrors(errors);
    if (Object.keys(errors).length) return;
    setNotice(undefined);
    saveDestination.mutate({
      kind: destinationKind,
      destination,
      accountRef: destinationKind === "paybill" ? accountRef.trim() : null,
    }, { onSuccess: () => setNotice("Payout destination saved. For your safety, payouts are held for 24 hours after a destination change.") });
  };

  const saveManualBankAccount = () => {
    const errors: Record<string, string> = {};
    if (!bankId) errors.bank = "Choose your bank";
    if (!/^\d{1,40}$/.test(accountNumber)) errors.accountNumber = "Enter an account number containing 1 to 40 digits";
    if (accountName.trim().length < 2 || accountName.trim().length > 120) errors.accountName = "Enter the account holder name";
    setManualErrors(errors);
    if (Object.keys(errors).length) return;
    setNotice(undefined);
    saveManual.mutate({ bankId: Number(bankId), accountNumber, accountName: accountName.trim() }, {
      onSuccess: () => setNotice("Bank details saved for manual transfers."),
    });
  };

  const connectOwnDaraja = () => {
    setNotice(undefined);
    connectDaraja.mutate({
      shortcode: darajaInput.shortcode.trim(),
      consumerKey: darajaInput.consumerKey.trim(),
      consumerSecret: darajaInput.consumerSecret.trim(),
      passkey: darajaInput.passkey.trim(),
    }, {
      onSuccess: (result) => {
        if (result.status === "connected") {
          setDarajaInput({ shortcode: "", consumerKey: "", consumerSecret: "", passkey: "" });
          setNotice("Safaricom Daraja connected. Tenants can now pay directly to your Paybill.");
        } else {
          setNotice(result.reason ?? "We could not connect to Safaricom Daraja. Check your details and try again.");
        }
      },
    });
  };

  const changeMode = (mode: PaymentMode) => {
    setNotice(undefined);
    setMode.mutate(mode, {
      onSuccess: () => setNotice(mode === "platform"
        ? "Platform M-Pesa collection is now active for your tenants. Payouts are processed by an admin."
        : mode === "own"
          ? "Safaricom Daraja is now active. Tenants pay directly to your Paybill."
          : "Manual bank transfer is now active for your tenants. You must confirm each received transfer."),
    });
  };

  const kindLabel = destinationKind === "mpesa_phone" ? "Safaricom M-Pesa phone number" : destinationKind === "till" ? "Safaricom Till number" : "Safaricom Paybill number";

  return (
    <div id="payment-setup" className="grid gap-4">
      {!embedded && <PageHead title="How you receive rent" sub="Choose a rent collection method, set your payout destination, and review how tenant payments are settled." />}
      <ErrorNote error={acct.error} />
      <ErrorNote error={payments.error} />
      <Panel tone="hero" className="landlord-payment-account grid gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-900"><ShieldCheck className="size-6" aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Choose how you receive rent</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">Your selected method applies to all active tenancies. A payment already in progress will finish on the route it started with.</p>
          </div>
        </div>
        <ErrorNote error={setMode.error} />
        {notice && <p role="status" className="text-sm text-ok">{notice}</p>}

        <div className="grid gap-3 xl:grid-cols-2">
          <div className={`landlord-payment-method grid content-start gap-4 rounded-xl border p-4 ${platformSelected ? "is-selected" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Smartphone className="size-6" aria-hidden /></span>
              {platformSelected && <Chip tone="ok">Selected</Chip>}
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Platform M-Pesa collection</h3>
              <p className="mt-1 text-sm text-slate-600">Tenants pay through the Safaricom M-Pesa prompt. Funds are tracked in your rent ledger. Payouts are requested here and processed by an admin.</p>
            </div>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white/70 p-3">
              <h4 className="text-sm font-bold text-slate-800">Safaricom payout destination</h4>
              <SelectField label="Receive payout by" value={destinationKind} onChange={(event) => setDestinationKind(event.target.value as DestinationKind)}>
                <option value="mpesa_phone">Safaricom M-Pesa phone number</option>
                <option value="till">Safaricom Till</option>
                <option value="paybill">Safaricom Paybill</option>
              </SelectField>
              <Field label={kindLabel} inputMode={destinationKind === "mpesa_phone" ? "tel" : "numeric"}
                value={destination} onChange={(event) => setDestination(destinationKind === "mpesa_phone" ? event.target.value.replace(/[^\d]/g, "") : event.target.value.replace(/\D/g, ""))}
                error={destinationErrors.destination} />
              {destinationKind === "paybill" && <Field label="Paybill account reference" value={accountRef} maxLength={40} onChange={(event) => setAccountRef(event.target.value)} error={destinationErrors.accountRef} />}
              {payments.data?.destination && <p className="text-xs text-slate-500">Current destination: {payments.data.destination.kind.replaceAll("_", " ")} · {payments.data.destination.destination}{payments.data.destination.accountRef ? ` · account ${payments.data.destination.accountRef}` : ""}</p>}
              <Button className="w-fit" loading={saveDestination.isPending} onClick={savePayoutDestination}>Save payout destination</Button>
              <ErrorNote error={saveDestination.error} />
              <p className="text-xs text-slate-500">Changing this destination pauses payout requests for 24 hours as a security measure.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={platformSelected ? "ghost" : "primary"} size="sm" disabled={!destinationReady || platformSelected} loading={setMode.isPending} onClick={() => changeMode("platform")}>
                {platformSelected ? "Currently selected" : destinationReady ? "Use platform collection" : "Save a payout destination first"}
              </Button>
            </div>
            {destinationReady && (
              <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <p><span className="block text-xs text-slate-500">Available for payout</span><strong className="text-slate-900">{formatKes(payoutSummary?.available ?? 0)}</strong></p>
                  <p><span className="block text-xs text-slate-500">Awaiting admin</span><strong className="text-slate-900">{formatKes(payoutSummary?.requested ?? 0)}</strong></p>
                </div>
                {payoutOpensAt && !payoutOpen && <p className="text-xs text-amber-900">Payout requests open after {fmtDate(payoutOpensAt.toISOString())}.</p>}
                <ErrorNote error={payout.error ?? requestPayout.error} />
                <Button variant="glass" className="w-fit text-slate-800" size="sm"
                  disabled={!platformSelected || !payoutOpen || (payoutSummary?.available ?? 0) < (payoutSummary?.minimum ?? 100) || (payoutSummary?.requested ?? 0) > 0}
                  loading={requestPayout.isPending} onClick={() => requestPayout.mutate(undefined, { onSuccess: () => setNotice("Payout requested. An admin will review and process it.") })}>
                  <Wallet className="size-4" aria-hidden />Request manual payout
                </Button>
                <p className="text-xs text-slate-600">Minimum request {formatKes(payoutSummary?.minimum ?? 100)}. An admin records the transfer reference when the payout is completed.</p>
              </div>
            )}
          </div>

          <div className={`landlord-payment-method grid content-start gap-3 rounded-xl border p-4 ${manualSelected ? "is-selected" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Landmark className="size-6" aria-hidden /></span>
              {manualSelected && <Chip tone="ok">Selected</Chip>}
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Manual bank transfer confirmation</h3>
              <p className="mt-1 text-sm text-slate-600">Tenants transfer directly to your bank and submit the transaction message. Verify the funds in your bank independently, then mark the claim received to add the verified amount to their rent ledger.</p>
            </div>
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white/70 p-3">
              <h4 className="text-sm font-bold text-slate-800">Bank account shown to tenants</h4>
              <ErrorNote error={bankSetup.error} />
              <ErrorNote error={saveManual.error} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Bank" value={bankId} onChange={(event) => setBankId(event.target.value)} error={manualErrors.bank}>
                  <option value="">Choose a bank</option>{bank?.banks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </SelectField>
                <Field label="Account holder name" value={accountName} maxLength={120} onChange={(event) => setAccountName(event.target.value)} error={manualErrors.accountName} />
                <Field label="Receiving account number" value={accountNumber} inputMode="numeric" maxLength={40} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ""))} error={manualErrors.accountNumber} />
                <div className="flex items-end"><Button className="w-full sm:w-auto" loading={saveManual.isPending} onClick={saveManualBankAccount}>Save bank details</Button></div>
              </div>
              <p className="text-xs text-slate-500">You cannot change bank details while a transfer claim is awaiting your review.</p>
            </div>
            <Button variant={manualSelected ? "ghost" : "primary"} size="sm" className="w-fit" disabled={!manualConfigured || manualSelected} loading={setMode.isPending} onClick={() => changeMode("bank_paybill")}>
              {manualSelected ? "Currently selected" : manualConfigured ? "Use manual bank transfer" : "Save bank details first"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`grid content-start gap-3 rounded-xl border p-4 ${ownSelected ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-white/70"}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900">Connect your Safaricom Daraja</h3>
              {ownSelected && <Chip tone="ok">Selected</Chip>}
              {!ownSelected && acct.data?.status === "connected" && <Chip tone="ok">Connected</Chip>}
            </div>
            <p className="text-sm text-slate-600">Enter your Safaricom Paybill and Daraja credentials. Tenants pay directly to your Paybill.</p>
            <div className="grid gap-3">
              <Field label="Safaricom Paybill number" inputMode="numeric" value={darajaInput.shortcode}
                onChange={(event) => setDarajaInput((old) => ({ ...old, shortcode: event.target.value.replace(/\D/g, "") }))} />
              <Field label="Consumer key" autoComplete="off" value={darajaInput.consumerKey}
                onChange={(event) => setDarajaInput((old) => ({ ...old, consumerKey: event.target.value }))} />
              <Field label="Consumer secret" type="password" autoComplete="new-password" value={darajaInput.consumerSecret}
                onChange={(event) => setDarajaInput((old) => ({ ...old, consumerSecret: event.target.value }))} />
              <Field label="Lipa Na M-Pesa passkey" type="password" autoComplete="new-password" value={darajaInput.passkey}
                onChange={(event) => setDarajaInput((old) => ({ ...old, passkey: event.target.value }))} />
            </div>
            <ErrorNote error={connectDaraja.error} />
            {acct.data?.status === "connected" && !ownSelected && (
              <Button variant="glass" className="w-fit" loading={setMode.isPending} onClick={() => changeMode("own")}>Use connected Daraja</Button>
            )}
            <Button className="w-fit" loading={connectDaraja.isPending} onClick={connectOwnDaraja}>Connect and use Daraja</Button>
          </div>
          <div className="grid content-start gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 opacity-75">
            <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-slate-700">Bank payouts</h3><Chip>Coming soon</Chip></div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
