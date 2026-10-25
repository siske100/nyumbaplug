// Safaricom Daraja: request builders, response readers and a small client. The builders and readers are pure and unit tested.
// CONFIRM ENDPOINT PATHS AND FIELDS AGAINST SAFARICOM'S CURRENT DOCUMENTATION BEFORE GOING LIVE. Test in the sandbox first.

export interface DarajaCreds { consumerKey: string; consumerSecret: string; shortcode: string; passkey: string }
export interface StkRequest { amount: number; msisdn: string; accountRef: string; description: string; callbackUrl: string }
export class DarajaError extends Error { constructor(message: string, public status = 0) { super(message); } }

export interface Daraja {
  token(c: Pick<DarajaCreds, "consumerKey" | "consumerSecret">): Promise<string>;
  stkPush(c: DarajaCreds, r: StkRequest): Promise<{ checkoutRequestId: string; merchantRequestId: string }>;
  /** resultCode -1 means "still being processed". */
  stkQuery(c: DarajaCreds, checkoutRequestId: string): Promise<{ resultCode: number; resultDesc: string }>;
  registerC2b(c: DarajaCreds, urls: { validation: string; confirmation: string }): Promise<void>;
}

export const baseUrl = (env: string) => (env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");

/** Daraja wants Nairobi time (UTC+3) as YYYYMMDDHHmmss. */
export function nairobiTimestamp(now = new Date()): string {
  const d = new Date(now.getTime() + 3 * 3600_000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}
export const stkPassword = (shortcode: string, passkey: string, ts: string) => btoa(`${shortcode}${passkey}${ts}`);
export const toMsisdn = (local: string) => { if (!/^(07|01)\d{8}$/.test(local)) throw new Error("Invalid phone number"); return "254" + local.slice(1); };

export function buildStkBody(c: DarajaCreds, r: StkRequest, now = new Date()) {
  if (!Number.isInteger(r.amount) || r.amount < 1) throw new Error("Invalid amount");
  const ts = nairobiTimestamp(now);
  return {
    BusinessShortCode: c.shortcode, Password: stkPassword(c.shortcode, c.passkey, ts), Timestamp: ts,
    TransactionType: "CustomerPayBillOnline", Amount: r.amount, PartyA: r.msisdn, PartyB: c.shortcode, PhoneNumber: r.msisdn,
    CallBackURL: r.callbackUrl, AccountReference: r.accountRef.slice(0, 12), TransactionDesc: r.description.slice(0, 13),
  };
}

export interface StkCallback { checkoutRequestId: string; merchantRequestId: string; resultCode: number; resultDesc: string; amount?: number; receipt?: string; phone?: string }

export function parseStkCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } } | null)?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string" || typeof cb.ResultCode !== "number") return null;
  const items = ((cb.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] } | undefined)?.Item) ?? [];
  const get = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = get("MpesaReceiptNumber"), amount = get("Amount"), phone = get("PhoneNumber");
  return {
    checkoutRequestId: cb.CheckoutRequestID, merchantRequestId: String(cb.MerchantRequestID ?? ""), resultCode: cb.ResultCode, resultDesc: String(cb.ResultDesc ?? ""),
    receipt: typeof receipt === "string" && /^[A-Z0-9]{8,12}$/.test(receipt) ? receipt : undefined,
    amount: typeof amount === "number" ? amount : undefined,
    phone: phone === undefined ? undefined : String(phone),
  };
}

export interface C2bPayment { receipt: string; amount: number; billRef: string; msisdn: string | null; shortcode: string }
export function parseC2b(body: unknown): C2bPayment | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.TransID !== "string" || !/^[A-Z0-9]{8,12}$/.test(b.TransID)) return null;
  const amount = Number(b.TransAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const ms = String(b.MSISDN ?? "");
  return { receipt: b.TransID, amount, billRef: String(b.BillRefNumber ?? "").trim().slice(0, 40), msisdn: /^254\d{9}$/.test(ms) ? "0" + ms.slice(3) : null, shortcode: String(b.BusinessShortCode ?? "") };
}

/** Whole shillings only. A fraction is rounded UP so it can never accidentally equal the amount due. */
export const wholeShillings = (amount: number) => Math.ceil(amount);

export function createDaraja(env: string, fetchImpl: typeof fetch = fetch): Daraja {
  const base = baseUrl(env);
  const cache = new Map<string, { token: string; expires: number }>();

  async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try { res = await fetchImpl(base + path, { ...init, signal: AbortSignal.timeout(15_000) }); }
    catch { throw new DarajaError("Could not reach Safaricom"); }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw Object.assign(new DarajaError(`Safaricom answered ${res.status}`, res.status), { body });
    return body;
  }

  const api: Daraja = {
    async token(c) {
      const hit = cache.get(c.consumerKey);
      if (hit && hit.expires > Date.now()) return hit.token;
      const r = await call("/oauth/v1/generate?grant_type=client_credentials", { headers: { Authorization: "Basic " + btoa(`${c.consumerKey}:${c.consumerSecret}`) } });
      if (typeof r.access_token !== "string") throw new DarajaError("Safaricom did not give a token");
      cache.set(c.consumerKey, { token: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3599) * 1000 - 60_000 });
      return r.access_token;
    },
    async stkPush(c, r) {
      const token = await api.token(c);
      const res = await call("/mpesa/stkpush/v1/processrequest", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(buildStkBody(c, r)) });
      if (String(res.ResponseCode) !== "0" || typeof res.CheckoutRequestID !== "string") throw new DarajaError("Safaricom did not accept the prompt");
      return { checkoutRequestId: res.CheckoutRequestID, merchantRequestId: String(res.MerchantRequestID ?? "") };
    },
    async stkQuery(c, checkoutRequestId) {
      const token = await api.token(c);
      const ts = nairobiTimestamp();
      try {
        const res = await call("/mpesa/stkpushquery/v1/query", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ BusinessShortCode: c.shortcode, Password: stkPassword(c.shortcode, c.passkey, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }) });
        return { resultCode: Number(res.ResultCode ?? -1), resultDesc: String(res.ResultDesc ?? "") };
      } catch (e) {
        if (e instanceof DarajaError && e.status >= 500) return { resultCode: -1, resultDesc: "still being processed" };   // Safaricom answers 500 while a prompt is open
        throw e;
      }
    },
    async registerC2b(c, urls) {
      const token = await api.token(c);
      await call("/mpesa/c2b/v2/registerurl", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ShortCode: c.shortcode, ResponseType: "Completed", ConfirmationURL: urls.confirmation, ValidationURL: urls.validation }) });
    },
  };
  return api;
}
