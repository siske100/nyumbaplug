import nodeAssert from "node:assert/strict";
import { HttpError, type Rpc } from "../_shared/ops.ts";
import {
  checkPayment, createPaystack, handlePaystackWebhook, keyAllowed, minorToKes, PaystackError, reconcilePaystack,
  settleReference, startPlatformCheckout, startRentCheckout, verifySignature, type Paystack, type PaystackDeps, type PaystackTx,
} from "../_shared/paystack.ts";
import { runCron } from "../_shared/cron.ts";

const eq = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const ok = (c: unknown, m?: string) => {
  if (m === undefined) nodeAssert.ok(c);
  else nodeAssert.ok(c, m);
};
async function rejectsWith(fn: () => Promise<unknown>, status: number, text?: RegExp) {
  try { await fn(); } catch (e) { ok(e instanceof HttpError, String(e)); eq((e as HttpError).status, status); if (text) ok(text.test((e as HttpError).message), (e as HttpError).message); return; }
  throw new Error("expected the call to fail");
}
const quiet = () => { const o = console.error; console.error = () => {}; return () => { console.error = o; }; };

const REF = "RHPS-11111111-2222-4333-8444-555555555555";
const LL = "landlord-1", PTOKEN = "PLATFORMTOKEN";
type Handler = (a: Record<string, unknown>) => { data?: unknown; error?: { code?: string; message: string } };
function fake(handlers: Record<string, Handler> = {}) {
  const calls: { fn: string; a: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, a) => { calls.push({ fn, a }); const r = handlers[fn]?.(a) ?? {}; return { data: r.data ?? null, error: r.error ?? null }; };
  return { rpc, calls, names: () => calls.map((c) => c.fn), last: (fn: string) => [...calls].reverse().find((c) => c.fn === fn)?.a };
}
const look = (over: Record<string, unknown> = {}) => ({ kind: "tenant", id: "a1", landlord_id: LL, payer_id: "tenant-1", amount: 6500, status: "pending", msisdn: "0712345678", created_at: new Date().toISOString(), ...over });
const tx = (over: Partial<PaystackTx> = {}): PaystackTx => ({ status: "success", reference: REF, amountMinor: 650000, currency: "KES", id: 99, channel: "mobile_money", ...over });

function mkPaystack(over: Partial<Paystack> = {}) {
  const inits: { secret: string; i: Record<string, unknown> }[] = [], verified: { secret: string; ref: string }[] = [];
  const p: Paystack = {
    initialize: async (secret, i) => { inits.push({ secret, i: i as unknown as Record<string, unknown> }); return { authorizationUrl: "https://checkout.paystack.com/xyz", reference: i.reference }; },
    verify: async (secret, ref) => { verified.push({ secret, ref }); return tx(); },
    checkKey: async () => {}, ...over,
  };
  return { p, inits, verified };
}
function deps(f: ReturnType<typeof fake>, p: Paystack, notified: string[] = [], over: Partial<PaystackDeps> = {}): PaystackDeps {
  return { rpc: f.rpc, paystack: p, platformSecret: "sk_live_PLATFORMKEY0000000000", notifyPaid: async (id) => { notified.push(id); },
    env: { appOrigin: "https://app.example.ke", functionsUrl: "https://x.supabase.co/functions/v1", platformToken: PTOKEN, live: true }, ...over };
}
const lookup = (l: unknown): Handler => () => ({ data: l });

async function sign(body: string, secret: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("paystack: amounts are whole shillings in cents, and keys must match the environment", () => {
  eq(minorToKes(650000), 6500); eq(minorToKes(650050), null); eq(minorToKes(0), null); eq(minorToKes(NaN), null); eq(minorToKes(-100), null);
  ok(keyAllowed("sk_live_abcdefghijklmnopqrstuv", true)); ok(!keyAllowed("sk_test_abcdefghijklmnopqrstuv", true));
  ok(keyAllowed("sk_test_abcdefghijklmnopqrstuv", false)); ok(!keyAllowed("pk_live_abcdefghijklmnopqrstuv", false)); ok(!keyAllowed("sk_live_short", false));
});

Deno.test("paystack signature: HMAC-SHA512 of the raw body, exact match only", async () => {
  const body = '{"event":"charge.success"}', sig = await sign(body, "sk_live_K");
  ok(await verifySignature(body, sig, "sk_live_K"));
  ok(await verifySignature(body, sig.toUpperCase(), "sk_live_K"));
  ok(!(await verifySignature(body + " ", sig, "sk_live_K")));
  ok(!(await verifySignature(body, sig, "sk_live_OTHER")));
  ok(!(await verifySignature(body, null, "sk_live_K")));
  ok(!(await verifySignature(body, "abc", "sk_live_K")));
});

Deno.test("paystack client: initialize sends KES cents with the key, verify and key check read the answer, bad answers are refused", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const mk = (status: number, body: unknown) => createPaystack((async (u: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(u), init: init! }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch);
  const good = mk(200, { status: true, data: { authorization_url: "https://checkout.paystack.com/xyz", access_code: "ac", reference: REF } });
  const out = await good.initialize("sk_live_K", { email: "a@b.ke", amountKes: 6500, reference: REF, callbackUrl: "https://app/paystack/return", metadata: { purpose: "rent" } });
  eq(out.authorizationUrl, "https://checkout.paystack.com/xyz");
  const sent = JSON.parse(String(seen[0].init.body));
  eq([sent.amount, sent.currency, sent.reference, sent.email], [650000, "KES", REF, "a@b.ke"]);
  eq((seen[0].init.headers as Record<string, string>).Authorization, "Bearer sk_live_K");
  eq(seen[0].url, "https://api.paystack.co/transaction/initialize");

  for (const url of ["http://checkout.paystack.com/x", "https://evil.example/x", "https://paystack.com.evil.example/x"]) {
    const bad = mk(200, { status: true, data: { authorization_url: url, reference: REF } });
    let failed = false; try { await bad.initialize("k", { email: "a@b.ke", amountKes: 1, reference: REF, callbackUrl: "x", metadata: {} }); } catch { failed = true; }
    ok(failed, url);
  }
  const wrongRef = mk(200, { status: true, data: { authorization_url: "https://checkout.paystack.com/x", reference: "OTHER" } });
  let failed = false; try { await wrongRef.initialize("k", { email: "a@b.ke", amountKes: 1, reference: REF, callbackUrl: "x", metadata: {} }); } catch { failed = true; } ok(failed);

  const v = await mk(200, { status: true, data: { status: "success", reference: REF, amount: 650000, currency: "KES", id: 7, channel: "card" } }).verify("k", REF);
  eq(v, { status: "success", reference: REF, amountMinor: 650000, currency: "KES", id: 7, channel: "card" });
  eq((await mk(404, { status: false, message: "Transaction reference not found" }).verify("k", REF)).status, "not_found");
  try { await mk(401, { status: false }).checkKey("k"); throw new Error("no"); } catch (e) { ok(e instanceof PaystackError && e.code === "rejected_key"); }
  await mk(200, { status: true, data: [] }).checkKey("k");
  try { await createPaystack((() => Promise.reject(new Error("down"))) as typeof fetch).checkKey("k"); throw new Error("no"); } catch (e) { ok(e instanceof PaystackError && e.code === "network"); }
});

Deno.test("settle: a successful rent payment is verified with HousePlug Kenya's key, credited once, and the tenant told", async () => {
  const f = fake({ paystack_attempt_lookup: lookup(look()), confirm_payment: () => ({ data: "ledger-1" }) });
  const { p, verified } = mkPaystack(); const notified: string[] = [];
  eq(await settleReference(deps(f, p, notified), REF), { state: "paid", kind: "tenant" });
  eq(verified, [{ secret: "sk_live_PLATFORMKEY0000000000", ref: REF }]);
  eq(f.last("confirm_payment"), { p_checkout: REF, p_receipt: "PSK-" + REF, p_amount: 6500, p_msisdn: "0712345678" });
  eq(notified, ["ledger-1"]);
});

Deno.test("settle: platform purchases use the platform confirmation", async () => {
  const f = fake({ paystack_attempt_lookup: lookup(look({ kind: "platform", purpose: "subscription", amount: 1000 })), confirm_platform_payment: () => ({ data: true }) });
  const { p } = mkPaystack({ verify: async () => tx({ amountMinor: 100000 }) });
  eq((await settleReference(deps(f, p), REF)).state, "paid");
  ok(f.names().includes("confirm_platform_payment") && !f.names().includes("confirm_payment"));
  eq(f.last("confirm_platform_payment"), { p_checkout: REF, p_receipt: "PSK-" + REF, p_amount: 1000, p_msisdn: "0712345678" });
});

Deno.test("settle: already paid, unknown and malformed references never reach Paystack or the ledger", async () => {
  const { p, verified } = mkPaystack();
  const paid = fake({ paystack_attempt_lookup: lookup(look({ status: "succeeded" })) });
  eq((await settleReference(deps(paid, p), REF)).state, "paid");
  eq((await settleReference(deps(fake(), p), REF)).state, "unknown");
  eq((await settleReference(deps(fake(), p), "not-a-reference")).state, "unknown");
  eq(verified.length, 0);
});

Deno.test("settle: nothing is credited for a wrong currency, a fractional amount or a different reference", async () => {
  const restore = quiet();
  for (const bad of [tx({ currency: "USD" }), tx({ amountMinor: 650050 }), tx({ reference: "RHPS-other" })]) {
    const f = fake({ paystack_attempt_lookup: lookup(look()) });
    eq((await settleReference(deps(f, mkPaystack({ verify: async () => bad }).p), REF)).state, "failed");
    ok(!f.names().includes("confirm_payment")); ok(f.names().includes("fail_payment_attempt"));
  }
  restore();
});

Deno.test("settle: a wrong amount or an already-paid rent is held, not reported as paid, and no text is sent", async () => {
  const f = fake({ paystack_attempt_lookup: lookup(look()), confirm_payment: () => ({ data: null }) });
  const notified: string[] = [];
  eq((await settleReference(deps(f, mkPaystack({ verify: async () => tx({ amountMinor: 500000 }) }).p, notified), REF)).state, "held");
  eq(f.last("confirm_payment")?.p_amount, 5000); eq(notified, []);
});

Deno.test("settle: failed payments are closed, unfinished ones keep waiting, abandoned ones are retired only after a while", async () => {
  const mkF = (age: number) => fake({ paystack_attempt_lookup: lookup(look({ created_at: new Date(Date.now() - age * 1000).toISOString() })) });
  const failed = mkF(60);
  eq((await settleReference(deps(failed, mkPaystack({ verify: async () => tx({ status: "failed" }) }).p), REF)).state, "failed");
  eq(failed.last("fail_payment_attempt")?.p_code, 4001);
  for (const status of ["ongoing", "pending", "processing", "queued"]) {
    const f = mkF(3600); eq((await settleReference(deps(f, mkPaystack({ verify: async () => tx({ status }) }).p), REF)).state, "pending"); ok(!f.names().includes("fail_payment_attempt"));
  }
  const young = mkF(600); eq((await settleReference(deps(young, mkPaystack({ verify: async () => tx({ status: "abandoned" }) }).p), REF)).state, "pending"); ok(!young.names().includes("fail_payment_attempt"));
  const old = mkF(3600); eq((await settleReference(deps(old, mkPaystack({ verify: async () => tx({ status: "abandoned" }) }).p), REF)).state, "expired");
  eq(old.last("fail_payment_attempt")?.p_code, 1037);
});

Deno.test("settle: Paystack being unreachable, or card payments switched off, is an error to retry, never a guess", async () => {
  const restore = quiet();
  const f = fake({ paystack_attempt_lookup: lookup(look()) });
  await rejectsWith(() => settleReference(deps(f, mkPaystack({ verify: async () => { throw new PaystackError("down"); } }).p), REF), 502);
  await rejectsWith(() => settleReference(deps(f, mkPaystack().p, [], { platformSecret: null }), REF), 503);
  restore();
  ok(!f.names().includes("confirm_payment"));
});

Deno.test("webhook: wrong address, wrong signature and other events credit nothing; a signed charge.success settles", async () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: REF } });
  const sig = await sign(body, "sk_live_PLATFORMKEY0000000000");
  const f = fake({ paystack_attempt_lookup: lookup(look()), confirm_payment: () => ({ data: "ledger-1" }) }); const { p } = mkPaystack();
  await rejectsWith(() => handlePaystackWebhook(deps(f, p), "WRONG", body, sig), 403);
  await rejectsWith(() => handlePaystackWebhook(deps(f, p), PTOKEN, body, "0".repeat(128)), 401);
  await rejectsWith(() => handlePaystackWebhook(deps(f, p), PTOKEN, body, null), 401);
  const forged = await sign(body, "sk_live_SOMEONEELSE00000000");
  await rejectsWith(() => handlePaystackWebhook(deps(f, p), PTOKEN, body, forged), 401);
  await rejectsWith(() => handlePaystackWebhook(deps(f, p, [], { platformSecret: null }), PTOKEN, body, sig), 403);
  await rejectsWith(() => handlePaystackWebhook(deps(f, p), PTOKEN, "x".repeat(100_001), sig), 413);
  ok(!f.names().includes("confirm_payment"));
  const other = JSON.stringify({ event: "transfer.success", data: { reference: REF } });
  eq(await handlePaystackWebhook(deps(f, p), PTOKEN, other, await sign(other, "sk_live_PLATFORMKEY0000000000")), { received: true });
  ok(!f.names().includes("confirm_payment"));
  const junk = JSON.stringify({ event: "charge.success", data: { reference: "not-ours" } });
  eq(await handlePaystackWebhook(deps(f, p), PTOKEN, junk, await sign(junk, "sk_live_PLATFORMKEY0000000000")), { received: true });
  eq((await handlePaystackWebhook(deps(f, p), PTOKEN, body, sig)).state, "paid");
  eq(f.calls.filter((c) => c.fn === "confirm_payment").length, 1);
});

Deno.test("rent checkout: HousePlug Kenya's account opens it, the database sets the amount, the address is saved, and the browser gets the link", async () => {
  const f = fake({ start_paystack_rent_attempt: () => ({ data: [{ attempt_id: "a1", amount: 6500, tenancy_code: "ABCD1234", landlord_id: LL }] }) });
  const { p, inits } = mkPaystack();
  const out = await startRentCheckout(deps(f, p), { tenancyId: "t1", tenancyCode: "ABCD1234", email: "t@x.ke", phone: "0712345678" });
  eq(out.state, "open"); eq((out as { checkoutUrl: string }).checkoutUrl, "https://checkout.paystack.com/xyz");
  eq(inits[0].secret, "sk_live_PLATFORMKEY0000000000");
  eq([inits[0].i.amountKes, inits[0].i.email, inits[0].i.callbackUrl], [6500, "t@x.ke", "https://app.example.ke/paystack/return"]);
  ok(/^RHPS-[0-9a-f-]{36}$/.test(String(inits[0].i.reference)));
  eq(f.last("start_paystack_rent_attempt")?.p_reference, inits[0].i.reference);
  eq(f.last("bind_paystack_checkout")?.p_kind, "tenant");
});

Deno.test("rent checkout: switched-off card payments are refused before anything is created; a failed opening cancels the attempt", async () => {
  const restore = quiet();
  const input = { tenancyId: "t", tenancyCode: "X", email: "a@b.ke", phone: "0712345678" };
  const none = fake();
  await rejectsWith(() => startRentCheckout(deps(none, mkPaystack().p, [], { platformSecret: null }), input), 503, /not available/);
  ok(!none.names().includes("start_paystack_rent_attempt"));
  const refused = fake({ start_paystack_rent_attempt: () => ({ error: { code: "P0001", message: "Tenancy not found" } }) });
  await rejectsWith(() => startRentCheckout(deps(refused, mkPaystack().p), input), 400);
  const g = fake({ start_paystack_rent_attempt: () => ({ data: [{ attempt_id: "a2", amount: 6500 }] }) });
  await rejectsWith(() => startRentCheckout(deps(g, mkPaystack({ initialize: async () => { throw new PaystackError("boom"); } }).p), input), 502);
  eq(g.last("fail_attempt_by_id")?.p_kind, "tenant");
  restore();
});

Deno.test("rent checkout: tapping again re-opens the same checkout instead of creating a second one, and a paid one is reported as paid", async () => {
  const open = (over: Record<string, unknown> = {}) => ({ data: [{ reference: REF, checkout_url: "https://checkout.paystack.com/old", amount: 6500, age_seconds: 120, balance: 6500, ...over }] });
  const input = { tenancyId: "t1", tenancyCode: "X", email: "a@b.ke", phone: "0712345678" };
  const again = fake({ open_paystack_rent_attempt: () => open(), paystack_attempt_lookup: lookup(look()) });
  const { p, inits } = mkPaystack({ verify: async () => tx({ status: "ongoing" }) });
  const out = await startRentCheckout(deps(again, p), input);
  eq(out, { state: "open", checkoutUrl: "https://checkout.paystack.com/old", reference: REF }); eq(inits.length, 0); ok(!again.names().includes("start_paystack_rent_attempt"));

  const paid = fake({ open_paystack_rent_attempt: () => open(), paystack_attempt_lookup: lookup(look()), confirm_payment: () => ({ data: "l1" }) });
  eq((await startRentCheckout(deps(paid, mkPaystack().p), input)).state, "paid"); ok(!paid.names().includes("start_paystack_rent_attempt"));

  const stale = fake({ open_paystack_rent_attempt: () => open({ age_seconds: 4000 }), paystack_attempt_lookup: lookup(look()),
    start_paystack_rent_attempt: () => ({ data: [{ attempt_id: "a9", amount: 6500 }] }) });
  const st = mkPaystack({ verify: async () => tx({ status: "ongoing" }) });
  eq((await startRentCheckout(deps(stale, st.p), input)).state, "open");
  eq(stale.last("fail_payment_attempt")?.p_code, 1037); eq(st.inits.length, 1);

  const changed = fake({ open_paystack_rent_attempt: () => open({ balance: 7000 }), paystack_attempt_lookup: lookup(look()), start_paystack_rent_attempt: () => ({ data: [{ attempt_id: "a9", amount: 7000 }] }) });
  eq((await startRentCheckout(deps(changed, st.p), input)).state, "open"); eq(changed.last("fail_payment_attempt")?.p_desc, "superseded");
});

Deno.test("platform checkout: needs the platform key, the database validates the purchase, and a repeat tap re-opens it", async () => {
  const input = { payerId: "l1", purpose: "subscription", amount: 1000, email: "l@x.ke", phone: "0712345678" };
  const restore = quiet();
  await rejectsWith(() => startPlatformCheckout(deps(fake(), mkPaystack().p, [], { platformSecret: null }), input), 503, /not available/);
  await rejectsWith(() => startPlatformCheckout(deps(fake(), mkPaystack().p), { ...input, amount: 10.5 }), 400);
  const refused = fake({ start_platform_attempt: () => ({ error: { code: "P0001", message: "The subscription is KES 1000" } }) });
  await rejectsWith(() => startPlatformCheckout(deps(refused, mkPaystack().p), { ...input, amount: 500 }), 400, /subscription is KES/);
  const broken = fake({ start_platform_attempt: () => ({ data: "pa1" }) });
  await rejectsWith(() => startPlatformCheckout(deps(broken, mkPaystack({ initialize: async () => { throw new PaystackError("x"); } }).p), input), 502);
  eq(broken.last("fail_attempt_by_id")?.p_kind, "platform");
  restore();

  const f = fake({ start_platform_attempt: () => ({ data: "pa1" }) });
  const { p, inits } = mkPaystack();
  const out = await startPlatformCheckout(deps(f, p), input);
  eq(out.state, "open"); eq(inits[0].secret, "sk_live_PLATFORMKEY0000000000");
  eq(f.last("start_platform_attempt")?.p_amount, 1000); eq(f.last("bind_paystack_checkout")?.p_kind, "platform");

  const again = fake({ open_paystack_platform_attempt: () => ({ data: [{ reference: REF, checkout_url: "https://checkout.paystack.com/old", amount: 1000, age_seconds: 60 }] }), paystack_attempt_lookup: lookup(look({ kind: "platform" })) });
  eq((await startPlatformCheckout(deps(again, mkPaystack({ verify: async () => tx({ status: "abandoned" }) }).p), input)).state, "open");
  ok(!again.names().includes("start_platform_attempt"));
});

Deno.test("check payment: only the payer or the receiving landlord may ask, and it settles through the same path", async () => {
  const f = fake({ paystack_attempt_lookup: lookup(look({ status: "succeeded" })) });
  const { p } = mkPaystack();
  eq(await checkPayment(deps(f, p), "tenant-1", REF), { state: "paid", kind: "tenant" });
  const plat = fake({ paystack_attempt_lookup: lookup(look({ kind: "platform", purpose: "sms_recharge", payer_id: "l1", landlord_id: "l1", status: "succeeded" })) });
  eq(await checkPayment(deps(plat, p), "l1", REF), { state: "paid", kind: "platform", purpose: "sms_recharge" });
  eq((await checkPayment(deps(f, p), LL, REF)).state, "paid");
  await rejectsWith(() => checkPayment(deps(f, p), "stranger", REF), 404);
  await rejectsWith(() => checkPayment(deps(fake(), p), "tenant-1", REF), 404);
  await rejectsWith(() => checkPayment(deps(fake(), p), "tenant-1", "junk"), 404);
});

Deno.test("reconcile: each open checkout is checked with Paystack, and one failure does not stop the rest", async () => {
  const refs = [REF, "RHPS-11111111-2222-4333-8444-666666666666", "RHPS-11111111-2222-4333-8444-777777777777"];
  const lookups: Record<string, unknown> = { [refs[0]]: look(), [refs[1]]: look(), [refs[2]]: look({ status: "succeeded" }) };
  const f = fake({ pending_paystack_attempts: () => ({ data: refs.map((reference) => ({ reference })) }),
    paystack_attempt_lookup: (a) => ({ data: lookups[String(a.p_reference)] }), confirm_payment: () => ({ data: "l1" }) });
  let n = 0; const restore = quiet();
  const { p } = mkPaystack({ verify: async (_s, r) => { if (++n === 2) throw new PaystackError("down"); return tx({ reference: r }); } });
  const out = await reconcilePaystack(deps(f, p)); restore();
  eq(out, { paid: 2, pending: 0, failed: 0, expired: 0, held: 0, errors: 1 });
  const cron = await runCron("reconcile", { rpc: f.rpc, pay: { rpc: f.rpc } as never, sms: {} as never, paystack: deps(fake({ pending_paystack_attempts: () => ({ data: [] }) }), p) }).catch((e) => e);
  ok(cron !== undefined);
});
