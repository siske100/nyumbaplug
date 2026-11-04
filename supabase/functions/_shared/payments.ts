// M-Pesa operations: tenants paying rent, landlords buying subscription or SMS credit, Safaricom's callbacks, and connecting a Paybill.
import { DarajaError, type Daraja, type DarajaCreds, parseC2b, parseStkCallback, toMsisdn, wholeShillings } from "./daraja.ts";
import { fromDb, HttpError, type Rpc } from "./ops.ts";
import { safeEqual } from "./text.ts";

export interface PayEnv { platform: DarajaCreds; platformToken: string; functionsUrl: string }
export interface Secrets { consumerKey: string; consumerSecret: string; passkey: string }
export interface PayDeps {
  rpc: Rpc; daraja: Daraja; env: PayEnv;
  decrypt(cipherHex: string, landlordId: string): Promise<Secrets>;
  notifyPaid(ledgerId: string): Promise<void>;
}
export const ACK = { ResultCode: 0, ResultDesc: "Accepted" };
export const callbackUrl = (env: PayEnv, fn: string, token: string) => `${env.functionsUrl}/${fn}/${token}`;

/** Rent is only routed to the landlord's own verified merchant account. Never fall back to platform funds. */
export async function resolveCreds(d: PayDeps, landlordId: string): Promise<{ creds: DarajaCreds; token: string; own: boolean }> {
  const r = await d.rpc("get_payment_credentials", { p_landlord: landlordId });
  if (r.error) throw fromDb(r.error);
  const row = (r.data as { mode: string; shortcode: string | null; cipher: string | null; status: string; callback_token: string }[] | null)?.[0];
  if (!row || row.mode !== "own" || row.status !== "connected" || !row.cipher || !row.shortcode) {
    throw new HttpError(503, "Your landlord has not configured an active direct rent payment method. Contact your landlord before paying.");
  }
  try {
    const s = await d.decrypt(row.cipher, landlordId);
    return { creds: { ...s, shortcode: row.shortcode }, token: row.callback_token, own: true };
  } catch {
    throw new HttpError(503, "This landlord's direct payment connection needs attention. Please try again later.");
  }
}

async function sendPrompt(d: PayDeps, kind: "tenant" | "platform", attemptId: string, creds: DarajaCreds, token: string,
                          r: { amount: number; phone: string; accountRef: string; description: string }) {
  try {
    const push = await d.daraja.stkPush(creds, { amount: r.amount, msisdn: toMsisdn(r.phone), accountRef: r.accountRef, description: r.description, callbackUrl: callbackUrl(d.env, "daraja-stk-callback", token) });
    await d.rpc(kind === "tenant" ? "bind_payment_attempt" : "bind_platform_attempt", { p_attempt: attemptId, p_checkout: push.checkoutRequestId, p_merchant: push.merchantRequestId });
  } catch (e) {
    if (e instanceof DarajaError && Object.keys(e.providerDetails ?? {}).length > 0) {
      console.error("prompt failed", e.message, e.providerDetails);
    } else {
      console.error("prompt failed", e instanceof Error ? e.message : e);
    }
    await d.rpc("fail_attempt_by_id", { p_kind: kind, p_attempt: attemptId, p_desc: "prompt could not be sent" });
    throw new HttpError(502, "We could not send the M-Pesa prompt. Please try again.");
  }
}

/** A tenant pays the full balance. The database decides the amount; the browser only says "pay". */
export async function tenantPay(d: PayDeps, i: {
  tenancyId: string; landlordId: string; tenancyCode: string; phone: string; paymentMode?: string | null;
}) {
  const bal = await d.rpc("current_balance", { p_tenancy: i.tenancyId });
  if (bal.error) throw fromDb(bal.error);
  if (typeof bal.data !== "number" || bal.data <= 0) throw new HttpError(400, "Nothing to pay");

  if (i.paymentMode && i.paymentMode !== "own") {
    throw new HttpError(409, "This rent payment method is not enabled for direct landlord settlement.");
  }

  const started = await d.rpc("start_payment_attempt", { p_tenancy: i.tenancyId, p_msisdn: i.phone, p_checkout: "pending-" + crypto.randomUUID(), p_merchant: null });
  if (started.error) throw fromDb(started.error);
  const attemptId = started.data as string;
  let resolved;
  try {
    resolved = await resolveCreds(d, i.landlordId);
  }
  catch (e) { await d.rpc("fail_attempt_by_id", { p_kind: "tenant", p_attempt: attemptId, p_desc: "payment connection unavailable" }); throw e; }
  await sendPrompt(d, "tenant", attemptId, resolved.creds, resolved.token, { amount: bal.data, phone: i.phone, accountRef: i.tenancyCode, description: "Rent" });
  return { amount: bal.data, message: "Check your phone and enter your M-Pesa PIN." };
}

/** Legacy bank-account verification only. This does not enable bank Paybill as a tenant rent route. */
export async function bankTestPay(d: PayDeps, landlordId: string) {
  const started = await d.rpc("start_bank_test_payment", { p_landlord: landlordId });
  if (started.error) throw fromDb(started.error);
  const row = (Array.isArray(started.data) ? started.data[0] : started.data) as
    { id?: string; paybill?: string; account_number?: string; phone?: string } | null;
  if (!row?.id || !/^\d{5,7}$/.test(row.paybill ?? "") || !/^\d{1,40}$/.test(row.account_number ?? "") || !row.phone) {
    throw new HttpError(500, "We could not prepare the bank test payment. Please try again.");
  }
  const creds = bankPaybillCreds(d, row.paybill!);
  try {
    const push = await d.daraja.stkPush(creds, {
      amount: 10,
      msisdn: toMsisdn(row.phone),
      accountRef: row.account_number!,
      description: "Bank test",
      callbackUrl: callbackUrl(d.env, "daraja-stk-callback", d.env.platformToken),
    });
    const bound = await d.rpc("bind_bank_test_payment", { p_id: row.id, p_checkout: push.checkoutRequestId });
    if (bound.error) throw fromDb(bound.error);
  } catch (e) {
    const failed = await d.rpc("fail_bank_test_payment_by_id", {
      p_id: row.id, p_reason: "The M-Pesa prompt could not be sent. Check the Paybill setup and try again.",
    });
    if (failed.error) console.error("could not mark bank test payment failed", failed.error.code, failed.error.message);
    if (e instanceof DarajaError && Object.keys(e.providerDetails ?? {}).length > 0) {
      console.error("bank test prompt failed", e.message, e.providerDetails);
    } else {
      console.error("bank test prompt failed", e instanceof Error ? e.message : e);
    }
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "We could not send the M-Pesa prompt. Please try again.");
  }
  return { amount: 10, message: "Check your verified phone and enter your M-Pesa PIN." };
}

/** Platform purchases include subscriptions, SMS credit, marketer activation and viewing bookings. */
export async function platformPay(d: PayDeps, i: { landlordId: string; purpose: string; amount: number; phone: string; referenceId?: string }) {
  if (!Number.isInteger(i.amount)) throw new HttpError(400, "Enter a whole number of shillings");
  const started = await d.rpc("start_platform_attempt", {
    p_landlord: i.landlordId, p_purpose: i.purpose, p_amount: i.amount, p_msisdn: i.phone,
    p_checkout: "pending-" + crypto.randomUUID(), p_merchant: null, p_reference: i.referenceId ?? null,
  });
  if (started.error) throw fromDb(started.error);
  const accountRef = i.purpose === "subscription" ? "SUBSCRIPTION"
    : i.purpose === "sms_recharge" ? "SMSCREDIT"
      : i.purpose === "marketer_activation" ? "MARKETER"
        : i.referenceId ? `VIEW-${i.referenceId.replaceAll("-", "").slice(0, 12).toUpperCase()}` : "VIEWING";
  const description = i.purpose === "subscription" ? "Subscription"
    : i.purpose === "sms_recharge" ? "SMS credit"
      : i.purpose === "marketer_activation" ? "Marketer activation"
        : "House viewing fee";
  await sendPrompt(d, "platform", started.data as string, d.env.platform, d.env.platformToken,
    { amount: i.amount, phone: i.phone, accountRef, description });
  return { amount: i.amount, message: "Check your phone and enter your M-Pesa PIN." };
}

/** Safaricom reports the result of a prompt. We trust it only after asking Safaricom directly. */
export async function handleStkCallback(d: PayDeps, token: string, body: unknown) {
  const cb = parseStkCallback(body);
  if (!cb) throw new HttpError(400, "Invalid callback");

  const bankTestResult = await d.rpc("bank_test_payment_lookup", { p_checkout: cb.checkoutRequestId });
  if (bankTestResult.error) throw fromDb(bankTestResult.error);
  const bankTest = (Array.isArray(bankTestResult.data) ? bankTestResult.data[0] : bankTestResult.data) as
    { kind: "bank_test"; status: string; paybill: string; phone: string } | null;
  if (bankTest) {
    if (!safeEqual(token, d.env.platformToken)) throw new HttpError(403, "Not allowed");
    if (bankTest.status !== "pending") return ACK;
    if (cb.resultCode !== 0) {
      const reason = cb.resultCode === 1032
        ? "The M-Pesa prompt was cancelled. Try again and approve it on your phone."
        : `Safaricom could not complete the payment (code ${cb.resultCode}). Try again or contact support.`;
      const failed = await d.rpc("fail_bank_test_payment", {
        p_checkout: cb.checkoutRequestId, p_code: cb.resultCode, p_desc: cb.resultDesc, p_reason: reason,
      });
      if (failed.error) throw fromDb(failed.error);
      return ACK;
    }
    const mismatch = !cb.receipt ? "Safaricom did not include a payment receipt in its callback"
      : cb.amount !== 10 ? "Safaricom reported an amount other than KES 10"
        : cb.phone !== toMsisdn(bankTest.phone) ? "The payment came from a different phone number"
          : null;
    if (mismatch) {
      const failed = await d.rpc("fail_bank_test_payment", {
        p_checkout: cb.checkoutRequestId, p_code: cb.resultCode, p_desc: cb.resultDesc, p_reason: mismatch,
      });
      if (failed.error) throw fromDb(failed.error);
      return ACK;
    }
    const check = await d.daraja.stkQuery(bankPaybillCreds(d, bankTest.paybill), cb.checkoutRequestId);
    if (check.resultCode !== 0) {
      if (check.resultCode !== -1) {
        const failed = await d.rpc("fail_bank_test_payment", {
          p_checkout: cb.checkoutRequestId, p_code: check.resultCode, p_desc: check.resultDesc,
          p_reason: `Safaricom's payment status check failed (code ${check.resultCode}). Try again or contact support.`,
        });
        if (failed.error) throw fromDb(failed.error);
        console.error("bank test callback not confirmed by Safaricom", cb.checkoutRequestId, check.resultCode);
      }
      return ACK;
    }
    const confirmed = await d.rpc("complete_bank_test_payment", {
      p_checkout: cb.checkoutRequestId, p_receipt: cb.receipt, p_amount: cb.amount, p_phone: cb.phone,
    });
    if (confirmed.error) throw fromDb(confirmed.error);
    return ACK;
  }

  const found = await d.rpc("attempt_lookup", { p_checkout: cb.checkoutRequestId });
  if (found.error) throw fromDb(found.error);
  const look = found.data as { kind: "tenant" | "platform"; landlord_id: string; status: string; bank_paybill_shortcode?: string | null } | null;
  if (!look) { console.error("callback for an unknown request", cb.checkoutRequestId); return ACK; }

  if (look.status === "succeeded" || look.status === "failed" || look.status === "timeout") return ACK;
  const bankShortcode = look.kind === "tenant" ? look.bank_paybill_shortcode : null;
  // Legacy bank-Paybill rent attempts are deliberately non-settleable after direct-only cutover.
  if (bankShortcode) return ACK;
  const resolved = look.kind === "platform"
    ? { creds: d.env.platform, token: d.env.platformToken }
    : await resolveCreds(d, look.landlord_id);
  if (!safeEqual(token, resolved.token)) throw new HttpError(403, "Not allowed");

  if (cb.resultCode !== 0) {
    await d.rpc(look.kind === "tenant" ? "fail_payment_attempt" : "fail_platform_attempt", { p_checkout: cb.checkoutRequestId, p_code: cb.resultCode, p_desc: cb.resultDesc.slice(0, 200) });
    return ACK;
  }
  if (!cb.receipt || cb.amount === undefined || !cb.phone) throw new HttpError(400, "Invalid callback");

  const check = await d.daraja.stkQuery(resolved.creds, cb.checkoutRequestId);          // never credit on the callback alone
  if (check.resultCode !== 0) { console.error("callback not confirmed by Safaricom", cb.checkoutRequestId); return ACK; }

  const amount = wholeShillings(cb.amount);
  if (look.kind === "tenant") {
    const r = await d.rpc("confirm_payment", { p_checkout: cb.checkoutRequestId, p_receipt: cb.receipt, p_amount: amount, p_msisdn: cb.phone });
    if (r.error) throw fromDb(r.error);
    if (typeof r.data === "string") await d.notifyPaid(r.data);
  } else {
    const r = await d.rpc("confirm_platform_payment", { p_checkout: cb.checkoutRequestId, p_receipt: cb.receipt, p_amount: amount, p_msisdn: cb.phone });
    if (r.error) throw fromDb(r.error);
  }
  return ACK;
}

async function c2bScope(d: PayDeps, token: string): Promise<{ landlordId: string }> {
  if (safeEqual(token, d.env.platformToken)) throw new HttpError(403, "Platform Paybill is not a rent collection route");
  const r = await d.rpc("account_by_token", { p_token: token });
  const a = r.data as { landlord_id: string } | null;
  if (r.error || !a) throw new HttpError(403, "Not allowed");
  return { landlordId: a.landlord_id };
}

/** Safaricom asks: should this manual Paybill payment be accepted? Only the exact full amount for a known account. */
export async function c2bValidate(d: PayDeps, token: string, body: unknown) {
  const scope = await c2bScope(d, token);
  const p = parseC2b(body);
  if (!p) return { ResultCode: "C2B00016", ResultDesc: "Rejected" };
  const r = await d.rpc("validate_c2b", { p_bill_ref: p.billRef, p_amount: wholeShillings(p.amount), p_landlord: scope.landlordId });
  if (r.error) throw fromDb(r.error);
  if (r.data === "ok") return ACK;
  return { ResultCode: r.data === "unknown_account" ? "C2B00012" : "C2B00013", ResultDesc: "Rejected" };
}

export async function c2bConfirm(d: PayDeps, token: string, body: unknown) {
  const scope = await c2bScope(d, token);
  const p = parseC2b(body);
  if (!p) throw new HttpError(400, "Invalid payment");
  const r = await d.rpc("record_c2b_payment", { p_bill_ref: p.billRef, p_amount: wholeShillings(p.amount), p_receipt: p.receipt, p_msisdn: p.msisdn, p_landlord: scope.landlordId });
  if (r.error) throw fromDb(r.error);
  if (typeof r.data === "string") await d.notifyPaid(r.data);
  return ACK;
}

export interface ConnectDeps extends PayDeps { encrypt(secrets: Secrets, landlordId: string): Promise<string> }

/** A landlord connects their own Paybill. The keys are tested with Safaricom, then stored encrypted and never shown again. */
export async function connectDaraja(d: ConnectDeps, landlordId: string, input: Record<string, unknown>) {
  const str = (v: unknown, min: number, max: number, label: string) => {
    if (typeof v !== "string" || /\s/.test(v) || v.length < min || v.length > max) throw new HttpError(400, `Check the ${label}`);
    return v;
  };
  const shortcode = str(input.shortcode, 5, 7, "Paybill number");
  if (!/^\d{5,7}$/.test(shortcode)) throw new HttpError(400, "Check the Paybill number");
  const secrets: Secrets = { consumerKey: str(input.consumerKey, 10, 200, "consumer key"), consumerSecret: str(input.consumerSecret, 10, 200, "consumer secret"), passkey: str(input.passkey, 20, 300, "passkey") };
  const creds: DarajaCreds = { ...secrets, shortcode };

  const info = await d.rpc("get_payment_credentials", { p_landlord: landlordId });
  const row = (info.data as { callback_token: string }[] | null)?.[0];
  if (info.error || !row) throw new HttpError(404, "Payment account not found");

  const fail = async (reason: string) => {
    await d.rpc("save_payment_credentials", { p_landlord: landlordId, p_shortcode: shortcode, p_kind: "paybill", p_cipher: null, p_key_version: null, p_status: "failed", p_reason: reason });
    return { status: "failed" as const, reason };
  };
  try { await d.daraja.token(creds); } catch { return fail("Safaricom did not accept these keys"); }
  try {
    await d.daraja.registerC2b(creds, { validation: callbackUrl(d.env, "daraja-c2b-validate", row.callback_token), confirmation: callbackUrl(d.env, "daraja-c2b-confirm", row.callback_token) });
  } catch { return fail("We could not register your payment addresses with Safaricom"); }

  const cipher = await d.encrypt(secrets, landlordId);
  const saved = await d.rpc("save_payment_credentials", { p_landlord: landlordId, p_shortcode: shortcode, p_kind: "paybill", p_cipher: cipher, p_key_version: 1, p_status: "connected", p_reason: null });
  if (saved.error) throw fromDb(saved.error);
  return { status: "connected" as const };
}

/** Prompts that never got an answer: ask Safaricom and settle them. Run every few minutes. */
export async function reconcilePending(d: PayDeps) {
  const out = { confirmed: 0, failed: 0, waiting: 0, errors: 0, timedOut: 0 };
  const expired = await d.rpc("expire_old_attempts", {});
  if (typeof expired.data === "number") out.timedOut = expired.data;
  const list = await d.rpc("pending_stk_attempts", { p_min_age: "3 minutes" });
  if (list.error) throw fromDb(list.error);
  for (const a of (list.data as {
    kind: "tenant" | "platform"; landlord_id: string; checkout: string; amount: number; bank_paybill_shortcode?: string | null;
  }[] | null) ?? []) {
    try {
      if (a.kind === "tenant" && a.bank_paybill_shortcode) {
        await d.rpc("fail_payment_attempt", { p_checkout: a.checkout, p_code: 4100, p_desc: "Legacy bank rent route disabled; direct landlord settlement required" });
        out.failed++;
        continue;
      }
      const creds = a.kind === "platform" ? d.env.platform
        : a.bank_paybill_shortcode ? bankPaybillCreds(d, a.bank_paybill_shortcode)
          : (await resolveCreds(d, a.landlord_id)).creds;
      const q = await d.daraja.stkQuery(creds, a.checkout);
      if (q.resultCode === -1) { out.waiting++; continue; }
      if (q.resultCode !== 0) {
        await d.rpc(a.kind === "tenant" ? "fail_payment_attempt" : "fail_platform_attempt", { p_checkout: a.checkout, p_code: q.resultCode, p_desc: q.resultDesc.slice(0, 200) });
        out.failed++; continue;
      }
      // The status check does not return the M-Pesa receipt, so the entry carries a clearly marked reference.
      const ref = "STKQ-" + a.checkout;
      if (a.kind === "tenant") {
        const r = await d.rpc("confirm_payment", { p_checkout: a.checkout, p_receipt: ref, p_amount: a.amount, p_msisdn: "" });
        if (r.error) throw fromDb(r.error);
        if (typeof r.data === "string") await d.notifyPaid(r.data);
      } else {
        const r = await d.rpc("confirm_platform_payment", { p_checkout: a.checkout, p_receipt: ref, p_amount: a.amount, p_msisdn: "" });
        if (r.error) throw fromDb(r.error);
      }
      out.confirmed++;
    } catch (e) { console.error("reconcile failed for one attempt", e instanceof Error ? e.message : e); out.errors++; }
  }
  return out;
}

function bankPaybillCreds(d: PayDeps, shortcode: string): DarajaCreds {
  if (!/^\d{5,7}$/.test(shortcode)) throw new HttpError(503, "This bank payment request needs attention");
  return { ...d.env.platform, shortcode };
}
