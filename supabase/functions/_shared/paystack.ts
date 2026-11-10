// Paystack (Kenya, KES): card + M-Pesa checkout into HousePlug Kenya's own Paystack account. It is used for tenants paying rent (held for
// the landlord, who is paid out on request) and for landlords buying a subscription or SMS credit.
// Rules that never bend: the amount is decided by the database, a reference is credited once, and nothing is credited on a
// webhook or browser claim alone. The server always asks Paystack itself (transaction verify) before crediting.
import { fromDb, HttpError, type Rpc } from "./ops.ts";
import { safeEqual } from "./text.ts";

export const PAYSTACK_API = "https://api.paystack.co";
/** An unpaid checkout is re-opened (not duplicated) for this long. After it, an abandoned checkout is retired. */
export const REOPEN_SECONDS = 30 * 60;
export const ABANDON_SECONDS = 45 * 60;

export class PaystackError extends Error {
  constructor(message: string, public status = 0, public code: "rejected_key" | "not_found" | "provider" | "network" = "provider") { super(message); }
}

export interface PaystackTx { status: string; reference: string; amountMinor: number; currency: string; id: number | null; channel: string | null }
export interface InitInput { email: string; amountKes: number; reference: string; callbackUrl: string; metadata: Record<string, unknown> }
export interface Paystack {
  initialize(secret: string, i: InitInput): Promise<{ authorizationUrl: string; reference: string }>;
  verify(secret: string, reference: string): Promise<PaystackTx>;
  checkKey(secret: string): Promise<void>;
}

export const SECRET_KEY = /^sk_(live|test)_[A-Za-z0-9]{16,100}$/;
export const newReference = () => "RHPS-" + crypto.randomUUID();
export const REFERENCE = /^RHPS-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const kesToMinor = (kes: number) => Math.round(kes * 100);
/** Paystack reports KES in cents. Anything that is not a whole number of shillings is refused rather than rounded. */
export const minorToKes = (minor: number): number | null => (Number.isInteger(minor) && minor > 0 && minor % 100 === 0 ? minor / 100 : null);

/** A test key must never take real tenants' rent (it would "succeed" with fake money), so live mode accepts live keys only. */
export function keyAllowed(secret: string, live: boolean): boolean {
  const m = SECRET_KEY.exec(secret);
  return !!m && (live ? m[1] === "live" : true);
}

export function createPaystack(fetchFn: typeof fetch = fetch): Paystack {
  async function call(secret: string, path: string, init: RequestInit = {}) {
    let res: Response;
    try {
      res = await fetchFn(PAYSTACK_API + path, {
        ...init, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json" },
      });
    } catch { throw new PaystackError("Paystack could not be reached", 0, "network"); }
    const body = await res.json().catch(() => null) as { status?: boolean; message?: string; data?: Record<string, unknown> } | null;
    if (res.status === 401 || res.status === 403) throw new PaystackError("Paystack did not accept this key", res.status, "rejected_key");
    if (res.status === 404) throw new PaystackError("Not found", 404, "not_found");
    if (!res.ok || !body || body.status !== true || !body.data) throw new PaystackError(typeof body?.message === "string" ? body.message.slice(0, 200) : "Paystack error", res.status);
    return body.data;
  }
  return {
    async initialize(secret, i) {
      const d = await call(secret, "/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({ email: i.email, amount: kesToMinor(i.amountKes), currency: "KES", reference: i.reference, callback_url: i.callbackUrl, metadata: i.metadata }),
      });
      const url = String(d.authorization_url ?? "");
      let host = "";
      try { const u = new URL(url); host = u.protocol === "https:" ? u.hostname : ""; } catch { /* handled below */ }
      if (!(host === "paystack.com" || host.endsWith(".paystack.com")) || d.reference !== i.reference) throw new PaystackError("Unexpected checkout address from Paystack");
      return { authorizationUrl: url, reference: String(d.reference) };
    },
    async verify(secret, reference) {
      try {
        const d = await call(secret, `/transaction/verify/${encodeURIComponent(reference)}`);
        return { status: String(d.status ?? ""), reference: String(d.reference ?? ""), amountMinor: Number(d.amount), currency: String(d.currency ?? ""),
                 id: typeof d.id === "number" ? d.id : null, channel: typeof d.channel === "string" ? d.channel : null };
      } catch (e) {
        if (e instanceof PaystackError && e.code === "not_found") return { status: "not_found", reference, amountMinor: 0, currency: "", id: null, channel: null };
        throw e;
      }
    },
    async checkKey(secret) { await call(secret, "/balance"); },
  };
}

/** Paystack signs the raw request body with HMAC-SHA512 using the account's secret key (header x-paystack-signature). */
export async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(rawBody)));
  return safeEqual([...mac].map((b) => b.toString(16).padStart(2, "0")).join(""), signature.toLowerCase());
}

export interface PaystackDeps {
  rpc: Rpc; paystack: Paystack;
  /** HousePlug Kenya's own key, or null when card payments are not set up (or the key does not match the environment). */
  platformSecret: string | null;
  notifyPaid(ledgerId: string): Promise<void>;
  env: { appOrigin: string; functionsUrl: string; platformToken: string; live: boolean };
}

export type Settled = { state: "paid" | "pending" | "failed" | "expired" | "held" | "unknown"; kind?: "tenant" | "platform" };

interface Look { kind: "tenant" | "platform"; purpose?: string; id: string; landlord_id: string; payer_id: string | null; amount: number; status: string; msisdn: string; created_at: string }
const lookup = async (d: PaystackDeps, reference: string): Promise<Look | null> => {
  if (!REFERENCE.test(reference)) return null;
  const r = await d.rpc("paystack_attempt_lookup", { p_reference: reference });
  if (r.error) throw fromDb(r.error);
  return (r.data as Look | null) ?? null;
};

/**
 * The one place a Paystack payment is confirmed. Webhook, return page and the scheduled check all come here, so they agree.
 * Safe to run any number of times for the same reference.
 */
export async function settleReference(d: PaystackDeps, reference: string): Promise<Settled> {
  const look = await lookup(d, reference);
  if (!look) return { state: "unknown" };
  const kind = look.kind;
  if (look.status === "succeeded") return { state: "paid", kind };

  const secret = d.platformSecret;
  if (!secret) throw new HttpError(503, "Card payments are not available right now");
  let tx: PaystackTx;
  try { tx = await d.paystack.verify(secret, reference); }
  catch (e) {
    console.error("paystack verify failed", e instanceof Error ? e.message : e);
    throw new HttpError(502, "We could not confirm this payment with Paystack yet. Please try again shortly.");
  }
  const failFn = kind === "tenant" ? "fail_payment_attempt" : "fail_platform_attempt";

  if (tx.status === "success") {
    const amount = minorToKes(tx.amountMinor);
    if (tx.reference !== reference || tx.currency !== "KES" || amount === null) {
      console.error("paystack success could not be trusted", reference, tx.currency, tx.amountMinor);
      await d.rpc(failFn, { p_checkout: reference, p_code: 4002, p_desc: "unexpected payment details" });
      return { state: "failed", kind };
    }
    const receipt = "PSK-" + reference;
    if (kind === "tenant") {
      const r = await d.rpc("confirm_payment", { p_checkout: reference, p_receipt: receipt, p_amount: amount, p_msisdn: look.msisdn });
      if (r.error) throw fromDb(r.error);
      if (typeof r.data !== "string") return { state: "held", kind };                // wrong amount or already paid: held for the landlord
      await d.notifyPaid(r.data);
    } else {
      const r = await d.rpc("confirm_platform_payment", { p_checkout: reference, p_receipt: receipt, p_amount: amount, p_msisdn: look.msisdn });
      if (r.error) throw fromDb(r.error);
      if (r.data !== true) return { state: "held", kind };
    }
    return { state: "paid", kind };
  }
  if (tx.status === "failed" || tx.status === "reversed") {
    await d.rpc(failFn, { p_checkout: reference, p_code: 4001, p_desc: `Paystack status: ${tx.status}`.slice(0, 200) });
    return { state: "failed", kind };
  }
  // abandoned / ongoing / pending / processing / queued: the payer may still be paying
  const age = (Date.now() - new Date(look.created_at).getTime()) / 1000;
  if (look.status === "pending" && tx.status === "abandoned" && age > ABANDON_SECONDS) {
    await d.rpc(failFn, { p_checkout: reference, p_code: 1037, p_desc: "Checkout was not completed" });   // 1037 = timeout: a late payment is still honoured
    return { state: "expired", kind };
  }
  return { state: look.status === "pending" ? "pending" : "expired", kind };
}

/** Paystack's webhook. The secret address picks it out, the signature proves it came from Paystack, and verify settles it. */
export async function handlePaystackWebhook(d: PaystackDeps, token: string, rawBody: string, signature: string | null) {
  if (rawBody.length > 100_000) throw new HttpError(413, "Request too large");
  const secret = d.platformSecret;
  if (!safeEqual(token, d.env.platformToken) || !secret) throw new HttpError(403, "Not allowed");
  if (!(await verifySignature(rawBody, signature, secret))) throw new HttpError(401, "Invalid signature");

  let body: { event?: unknown; data?: { reference?: unknown } };
  try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, "Invalid request"); }
  const reference = typeof body.data?.reference === "string" ? body.data.reference : "";
  if (body.event !== "charge.success" || !REFERENCE.test(reference)) return { received: true };       // other events are acknowledged and ignored
  const out = await settleReference(d, reference);
  return { received: true, state: out.state };
}

const callbackUrl = (d: PaystackDeps) => `${d.env.appOrigin}/paystack/return`;
const GONE_STALE = "superseded";

/** Tenant taps "Pay rent by card or M-Pesa". The database decides the amount; HousePlug Kenya collects it and holds it for the landlord. */
export async function startRentCheckout(d: PaystackDeps, i: { tenancyId: string; tenancyCode: string; email: string; phone: string }) {
  const secret = d.platformSecret;
  if (!secret) throw new HttpError(503, "Card payments are not available right now. Pay with the M-Pesa prompt instead.");

  const open = await d.rpc("open_paystack_rent_attempt", { p_tenancy: i.tenancyId });
  if (open.error) throw fromDb(open.error);
  const o = (open.data as { reference: string; checkout_url: string | null; amount: number; age_seconds: number; balance: number }[] | null)?.[0];
  if (o) {
    const s = await settleReference(d, o.reference);                      // it may have been paid already
    if (s.state === "paid" || s.state === "held") return { state: s.state as "paid" | "held" };
    if (o.checkout_url && o.age_seconds < REOPEN_SECONDS && o.amount === o.balance) return { state: "open" as const, checkoutUrl: o.checkout_url, reference: o.reference };
    await d.rpc("fail_payment_attempt", { p_checkout: o.reference, p_code: 1037, p_desc: GONE_STALE });
  }

  const reference = newReference();
  const started = await d.rpc("start_paystack_rent_attempt", { p_tenancy: i.tenancyId, p_reference: reference, p_msisdn: i.phone });
  if (started.error) throw fromDb(started.error);
  const row = (started.data as { attempt_id: string; amount: number }[] | null)?.[0];
  if (!row) throw new HttpError(500, "Something went wrong. Please try again.");
  try {
    const init = await d.paystack.initialize(secret, {
      email: i.email, amountKes: row.amount, reference, callbackUrl: callbackUrl(d),
      metadata: { purpose: "rent", tenancy_code: i.tenancyCode, custom_fields: [{ display_name: "Tenancy code", variable_name: "tenancy_code", value: i.tenancyCode }] },
    });
    const bound = await d.rpc("bind_paystack_checkout", { p_kind: "tenant", p_attempt: row.attempt_id, p_reference: reference, p_url: init.authorizationUrl });
    if (bound.error) throw fromDb(bound.error);
    return { state: "open" as const, checkoutUrl: init.authorizationUrl, reference };
  } catch (e) {
    console.error("rent checkout failed", e instanceof Error ? e.message : e);
    await d.rpc("fail_attempt_by_id", { p_kind: "tenant", p_attempt: row.attempt_id, p_desc: "checkout could not be created" });
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "We could not open the payment page. Please try again.");
  }
}

/** A landlord pays HousePlug Kenya (subscription, SMS credit) by card or M-Pesa. */
export async function startPlatformCheckout(d: PaystackDeps, i: { payerId: string; purpose: string; amount: number; email: string; phone: string; referenceId?: string }) {
  if (!d.platformSecret) throw new HttpError(503, "Card payments are not available right now. Pay with M-Pesa instead.");
  if (!Number.isInteger(i.amount) || i.amount <= 0) throw new HttpError(400, "Enter a whole number of shillings");

  const open = await d.rpc("open_paystack_platform_attempt", { p_payer: i.payerId, p_purpose: i.purpose, p_reference: i.referenceId ?? null });
  if (open.error) throw fromDb(open.error);
  const o = (open.data as { reference: string; checkout_url: string | null; amount: number; age_seconds: number }[] | null)?.[0];
  if (o) {
    const s = await settleReference(d, o.reference);
    if (s.state === "paid" || s.state === "held") return { state: s.state as "paid" | "held" };
    if (o.checkout_url && o.age_seconds < REOPEN_SECONDS && o.amount === i.amount) return { state: "open" as const, checkoutUrl: o.checkout_url, reference: o.reference };
    await d.rpc("fail_platform_attempt", { p_checkout: o.reference, p_code: 1037, p_desc: GONE_STALE });
  }

  const started = await d.rpc("start_platform_attempt", {
    p_landlord: i.payerId, p_purpose: i.purpose, p_amount: i.amount, p_msisdn: i.phone,
    p_checkout: "pending-" + crypto.randomUUID(), p_merchant: null, p_reference: i.referenceId ?? null,
  });
  if (started.error) throw fromDb(started.error);
  const attemptId = started.data as string;
  const reference = newReference();
  try {
    const init = await d.paystack.initialize(d.platformSecret, {
      email: i.email, amountKes: i.amount, reference, callbackUrl: callbackUrl(d),
      metadata: { purpose: i.purpose, custom_fields: [{ display_name: "Purchase", variable_name: "purchase", value: i.purpose }] },
    });
    const bound = await d.rpc("bind_paystack_checkout", { p_kind: "platform", p_attempt: attemptId, p_reference: reference, p_url: init.authorizationUrl });
    if (bound.error) throw fromDb(bound.error);
    return { state: "open" as const, checkoutUrl: init.authorizationUrl, reference };
  } catch (e) {
    console.error("platform checkout failed", e instanceof Error ? e.message : e);
    await d.rpc("fail_attempt_by_id", { p_kind: "platform", p_attempt: attemptId, p_desc: "checkout could not be created" });
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "We could not open the payment page. Please try again.");
  }
}

/** The return page and anyone checking on a payment. Only the payer, or the landlord who receives it, may ask. */
export async function checkPayment(d: PaystackDeps, userId: string, reference: string) {
  const look = await lookup(d, reference);
  if (!look || (look.payer_id !== userId && look.landlord_id !== userId)) throw new HttpError(404, "Payment not found");
  const s = await settleReference(d, reference);
  return { state: s.state, kind: look.kind, ...(look.purpose ? { purpose: look.purpose } : {}) };
}

/** Scheduled safety net: every Paystack checkout that never reported back is checked with Paystack. One failure does not stop the rest. */
export async function reconcilePaystack(d: PaystackDeps) {
  const out = { paid: 0, pending: 0, failed: 0, expired: 0, held: 0, errors: 0 };
  const list = await d.rpc("pending_paystack_attempts", { p_min_age: "2 minutes" });
  if (list.error) throw fromDb(list.error);
  for (const a of (list.data as { reference: string }[] | null) ?? []) {
    try {
      const s = await settleReference(d, a.reference);
      if (s.state === "paid") out.paid++; else if (s.state === "pending") out.pending++; else if (s.state === "failed") out.failed++;
      else if (s.state === "expired") out.expired++; else if (s.state === "held") out.held++;
    } catch (e) { console.error("paystack reconcile failed for one attempt", e instanceof Error ? e.message : e); out.errors++; }
  }
  return out;
}
