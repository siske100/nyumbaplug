import nodeAssert from "node:assert/strict";
import type { Daraja, DarajaCreds } from "../_shared/daraja.ts";
import { acceptInvite, createInvite, lookupInvite } from "../_shared/invites.ts";
import { broadcast, notifyPaid, reminderSms, runReminders, sendLandlordSms, submitVisitRequest } from "../_shared/messaging.ts";
import { runCron } from "../_shared/cron.ts";
import { HttpError, type Rpc } from "../_shared/ops.ts";
import { c2bConfirm, c2bValidate, connectDaraja, handleStkCallback, platformPay, reconcilePending, tenantPay, type ConnectDeps } from "../_shared/payments.ts";

const eq = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const ok = (c: unknown, m?: string) => nodeAssert.ok(c, m);
async function rejectsWith(fn: () => Promise<unknown>, status: number, text?: RegExp) {
  try { await fn(); } catch (e) { ok(e instanceof HttpError, String(e)); eq((e as HttpError).status, status); if (text) ok(text.test((e as HttpError).message), (e as HttpError).message); return; }
  throw new Error("expected the call to fail");
}
const quiet = () => { const o = console.error; console.error = () => {}; return () => { console.error = o; }; };

type Handler = (a: Record<string, unknown>) => { data?: unknown; error?: { code?: string; message: string } };
function fake(handlers: Record<string, Handler> = {}) {
  const calls: { fn: string; a: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, a) => { calls.push({ fn, a }); const r = handlers[fn]?.(a) ?? {}; return { data: r.data ?? null, error: r.error ?? null }; };
  return { rpc, calls, names: () => calls.map((c) => c.fn), last: (fn: string) => [...calls].reverse().find((c) => c.fn === fn)?.a };
}

const PLATFORM: DarajaCreds = { consumerKey: "pk", consumerSecret: "ps", shortcode: "174379", passkey: "pass" };
const OWN: DarajaCreds = { consumerKey: "ok", consumerSecret: "os", shortcode: "600123", passkey: "own-pass" };
function mkDaraja(over: Partial<Daraja> = {}) {
  const pushes: { creds: DarajaCreds; req: Record<string, unknown> }[] = [];
  const queried: string[] = [];
  const d: Daraja = {
    token: async () => "T", registerC2b: async () => {},
    stkPush: async (creds, req) => { pushes.push({ creds, req: req as unknown as Record<string, unknown> }); return { checkoutRequestId: "ws_CO_1", merchantRequestId: "mr1" }; },
    stkQuery: async (_c, id) => { queried.push(id); return { resultCode: 0, resultDesc: "ok" }; }, ...over,
  };
  return { d, pushes, queried };
}
function payDeps(f: ReturnType<typeof fake>, dj: Daraja, notified: string[] = [], over: Partial<ConnectDeps> = {}): ConnectDeps {
  return { rpc: f.rpc, daraja: dj, env: { platform: PLATFORM, platformToken: "PLATFORMTOKEN", functionsUrl: "https://x.supabase.co/functions/v1" },
    decrypt: async () => ({ consumerKey: OWN.consumerKey, consumerSecret: OWN.consumerSecret, passkey: OWN.passkey }),
    encrypt: async () => "\\xCIPHER", notifyPaid: async (id) => { notified.push(id); }, ...over };
}
const platformAccount: Handler = () => ({ data: [{ mode: "platform", shortcode: null, cipher: null, status: "not_connected", callback_token: "LLTOKEN" }] });
const ownAccount = (status = "connected"): Handler => () => ({ data: [{ mode: "own", shortcode: "600123", cipher: "\\x01", status, callback_token: "LLTOKEN" }] });
const cb = (over: Record<string, unknown> = {}) => ({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: "ws_CO_1", ResultCode: 0, ResultDesc: "ok", CallbackMetadata: { Item: [
  { Name: "Amount", Value: 6500 }, { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" }, { Name: "PhoneNumber", Value: 254712345678 }] }, ...over } } });

// ---------------- tenants paying ----------------
Deno.test("tenant pays: the full balance, the prompt goes to the verified phone, with the platform's Paybill by default", async () => {
  const f = fake({ current_balance: () => ({ data: 6500 }), start_payment_attempt: () => ({ data: "att-1" }), get_payment_credentials: platformAccount });
  const { d, pushes } = mkDaraja();
  const out = await tenantPay(payDeps(f, d), { tenancyId: "t1", landlordId: "l1", tenancyCode: "ABCD1234", phone: "0712345678" });
  eq(out.amount, 6500);
  eq(pushes[0]!.creds, PLATFORM);
  eq(pushes[0]!.req.msisdn, "254712345678"); eq(pushes[0]!.req.amount, 6500); eq(pushes[0]!.req.accountRef, "ABCD1234");
  eq(pushes[0]!.req.callbackUrl, "https://x.supabase.co/functions/v1/daraja-stk-callback/PLATFORMTOKEN");
  eq(f.names(), ["current_balance", "start_payment_attempt", "get_payment_credentials", "bind_payment_attempt"]);
  ok(String(f.last("start_payment_attempt")!.p_checkout).startsWith("pending-"));
  eq(f.last("bind_payment_attempt"), { p_attempt: "att-1", p_checkout: "ws_CO_1", p_merchant: "mr1" });
});

Deno.test("tenant pays: a landlord with a connected own Paybill gets the rent in it", async () => {
  const f = fake({ current_balance: () => ({ data: 12000 }), start_payment_attempt: () => ({ data: "a" }), get_payment_credentials: ownAccount() });
  const { d, pushes } = mkDaraja();
  await tenantPay(payDeps(f, d), { tenancyId: "t", landlordId: "l1", tenancyCode: "ZZ99", phone: "0712345678" });
  eq(pushes[0]!.creds, OWN);
  eq(pushes[0]!.req.callbackUrl, "https://x.supabase.co/functions/v1/daraja-stk-callback/LLTOKEN");
});

Deno.test("tenant pays: a broken own connection stops the payment instead of sending rent to the wrong place", async () => {
  const restore = quiet();
  const f = fake({ current_balance: () => ({ data: 6500 }), start_payment_attempt: () => ({ data: "a" }), get_payment_credentials: ownAccount("failed") });
  const { d, pushes } = mkDaraja();
  await rejectsWith(() => tenantPay(payDeps(f, d), { tenancyId: "t", landlordId: "l", tenancyCode: "Z", phone: "0712345678" }), 503);
  restore();
  eq(pushes.length, 0); ok(f.names().includes("fail_attempt_by_id"));
  const g = fake({ current_balance: () => ({ data: 6500 }), start_payment_attempt: () => ({ data: "a" }), get_payment_credentials: ownAccount() });
  const bad = payDeps(g, d, [], { decrypt: async () => { throw new Error("bad key"); } });
  await rejectsWith(() => tenantPay(bad, { tenancyId: "t", landlordId: "l", tenancyCode: "Z", phone: "0712345678" }), 503);
});

Deno.test("tenant pays: nothing owed, or a prompt that cannot be sent, are handled cleanly", async () => {
  const none = fake({ current_balance: () => ({ data: 0 }) });
  await rejectsWith(() => tenantPay(payDeps(none, mkDaraja().d), { tenancyId: "t", landlordId: "l", tenancyCode: "Z", phone: "0712345678" }), 400, /Nothing to pay/);
  eq(none.names(), ["current_balance"]);
  const restore = quiet();
  const f = fake({ current_balance: () => ({ data: 6500 }), start_payment_attempt: () => ({ data: "att" }), get_payment_credentials: platformAccount });
  const down = mkDaraja({ stkPush: async () => { throw new Error("Safaricom down"); } }).d;
  await rejectsWith(() => tenantPay(payDeps(f, down), { tenancyId: "t", landlordId: "l", tenancyCode: "Z", phone: "0712345678" }), 502);
  restore();
  eq(f.last("fail_attempt_by_id")!.p_attempt, "att");
});

// ---------------- landlords buying ----------------
Deno.test("landlord purchase: whole shillings only, rules come from the database, always the platform Paybill", async () => {
  const f = fake({ start_platform_attempt: () => ({ data: "pa-1" }) });
  const { d, pushes } = mkDaraja();
  await rejectsWith(() => platformPay(payDeps(f, d), { landlordId: "l", purpose: "subscription", amount: 1000.5, phone: "0712345678" }), 400);
  const out = await platformPay(payDeps(f, d), { landlordId: "l", purpose: "subscription", amount: 1125, phone: "0712345678" });
  eq(out.amount, 1125); eq(pushes[0]!.creds, PLATFORM); eq(pushes[0]!.req.accountRef, "SUBSCRIPTION");
  const refuse = fake({ start_platform_attempt: () => ({ error: { code: "P0001", message: "The subscription is KES 1125" } }) });
  await rejectsWith(() => platformPay(payDeps(refuse, d), { landlordId: "l", purpose: "subscription", amount: 900, phone: "0712345678" }), 400, /KES 1125/);
});

// ---------------- Safaricom's answers ----------------
Deno.test("callback: a wrong secret address is refused and nothing is credited", async () => {
  const f = fake({ attempt_lookup: () => ({ data: { kind: "tenant", landlord_id: "l1", status: "pending" } }), get_payment_credentials: platformAccount });
  const { d, queried } = mkDaraja();
  await rejectsWith(() => handleStkCallback(payDeps(f, d), "WRONG", cb()), 403);
  eq(queried.length, 0); ok(!f.names().includes("confirm_payment"));
});

Deno.test("callback: a successful payment is checked with Safaricom, credited once, and the tenant is told", async () => {
  const notified: string[] = [];
  const f = fake({ attempt_lookup: () => ({ data: { kind: "tenant", landlord_id: "l1", status: "pending" } }), get_payment_credentials: platformAccount, confirm_payment: () => ({ data: "ledger-9" }) });
  const { d, queried } = mkDaraja();
  await handleStkCallback(payDeps(f, d, notified), "PLATFORMTOKEN", cb());
  eq(queried, ["ws_CO_1"]);
  eq(f.last("confirm_payment"), { p_checkout: "ws_CO_1", p_receipt: "NLJ7RT61SV", p_amount: 6500, p_msisdn: "254712345678" });
  eq(notified, ["ledger-9"]);
});

Deno.test("callback: a forged success that Safaricom does not confirm credits nothing", async () => {
  const restore = quiet();
  const f = fake({ attempt_lookup: () => ({ data: { kind: "tenant", landlord_id: "l1", status: "pending" } }), get_payment_credentials: platformAccount });
  const { d } = mkDaraja({ stkQuery: async () => ({ resultCode: 1032, resultDesc: "cancelled" }) });
  await handleStkCallback(payDeps(f, d), "PLATFORMTOKEN", cb());
  restore();
  ok(!f.names().includes("confirm_payment"));
});

Deno.test("callback: cancelled prompts, unknown requests, repeats and junk", async () => {
  const f = fake({ attempt_lookup: () => ({ data: { kind: "tenant", landlord_id: "l1", status: "pending" } }), get_payment_credentials: platformAccount });
  const { d, queried } = mkDaraja();
  await handleStkCallback(payDeps(f, d), "PLATFORMTOKEN", { Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: "ws_CO_1", ResultCode: 1032, ResultDesc: "Request cancelled by user" } } });
  eq(f.last("fail_payment_attempt")!.p_code, 1032); eq(queried.length, 0);
  const restore = quiet();
  const unknown = fake({ attempt_lookup: () => ({ data: null }) });
  eq((await handleStkCallback(payDeps(unknown, d), "x", cb())).ResultCode, 0); ok(!unknown.names().includes("confirm_payment"));
  restore();
  const done = fake({ attempt_lookup: () => ({ data: { kind: "tenant", landlord_id: "l1", status: "succeeded" } }), get_payment_credentials: platformAccount });
  await handleStkCallback(payDeps(done, d), "PLATFORMTOKEN", cb()); ok(!done.names().includes("confirm_payment"));
  await rejectsWith(() => handleStkCallback(payDeps(f, d), "PLATFORMTOKEN", { nonsense: true }), 400);
  await rejectsWith(() => handleStkCallback(payDeps(f, d), "PLATFORMTOKEN", cb({ CallbackMetadata: { Item: [] } })), 400);
});

Deno.test("callback: landlord purchases are confirmed against the platform Paybill", async () => {
  const f = fake({ attempt_lookup: () => ({ data: { kind: "platform", landlord_id: "l1", status: "pending" } }), confirm_platform_payment: () => ({ data: true }) });
  const { d, pushes } = mkDaraja();
  await rejectsWith(() => handleStkCallback(payDeps(f, d), "LLTOKEN", cb()), 403);
  await handleStkCallback(payDeps(f, d), "PLATFORMTOKEN", cb());
  eq(f.last("confirm_platform_payment")!.p_receipt, "NLJ7RT61SV"); eq(pushes.length, 0);
});

Deno.test("manual Paybill: wrong secret refused, wrong amounts and accounts rejected with Safaricom's codes", async () => {
  const body = { TransID: "RKTQDM7W6S", TransAmount: "6500.00", BillRefNumber: "ABCD1234", MSISDN: "254712345678" };
  const f = fake({ account_by_token: (a) => ({ data: a.p_token === "LLTOKEN" ? { landlord_id: "l1" } : null }), validate_c2b: () => ({ data: "ok" }) });
  const dep = payDeps(f, mkDaraja().d);
  await rejectsWith(() => c2bValidate(dep, "BAD", body), 403);
  eq((await c2bValidate(dep, "PLATFORMTOKEN", body)).ResultCode, 0);
  eq(f.last("validate_c2b")!.p_landlord, null);
  await c2bValidate(dep, "LLTOKEN", body);
  eq(f.last("validate_c2b")!.p_landlord, "l1");
  for (const [answer, code] of [["unknown_account", "C2B00012"], ["amount_mismatch", "C2B00013"], ["nothing_due", "C2B00013"]]) {
    const g = fake({ validate_c2b: () => ({ data: answer }) });
    eq((await c2bValidate(payDeps(g, mkDaraja().d), "PLATFORMTOKEN", body)).ResultCode, code);
  }
  eq((await c2bValidate(dep, "PLATFORMTOKEN", { junk: 1 })).ResultCode, "C2B00016");
});

Deno.test("manual Paybill: the payment is recorded and the tenant told, only when it was credited", async () => {
  const body = { TransID: "RKTQDM7W6S", TransAmount: "6500", BillRefNumber: "ABCD1234", MSISDN: "254712345678" };
  const notified: string[] = [];
  const f = fake({ record_c2b_payment: () => ({ data: "ledger-1" }) });
  await c2bConfirm(payDeps(f, mkDaraja().d, notified), "PLATFORMTOKEN", body);
  eq(notified, ["ledger-1"]); eq(f.last("record_c2b_payment")!.p_msisdn, "0712345678");
  const held = fake({ record_c2b_payment: () => ({ data: null }) });
  const n2: string[] = [];
  await c2bConfirm(payDeps(held, mkDaraja().d, n2), "PLATFORMTOKEN", body);
  eq(n2, []);
  await rejectsWith(() => c2bConfirm(payDeps(f, mkDaraja().d), "PLATFORMTOKEN", { junk: 1 }), 400);
});

// ---------------- connecting a Paybill ----------------
const KEYS = { shortcode: "600123", consumerKey: "consumer-key-123", consumerSecret: "consumer-secret-123", passkey: "passkey-passkey-passkey-1234" };
Deno.test("connect: keys are tested with Safaricom, stored only encrypted, and never logged or returned", async () => {
  const f = fake({ get_payment_credentials: platformAccount });
  const logs: string[] = []; const o = console.log; console.log = (...a) => logs.push(a.join(" "));
  let registered: unknown;
  const { d } = mkDaraja({ registerC2b: async (_c, urls) => { registered = urls; } });
  const out = await connectDaraja(payDeps(f, d), "l1", KEYS);
  console.log = o;
  eq(out, { status: "connected" });
  const save = f.last("save_payment_credentials")!;
  eq(save.p_cipher, "\\xCIPHER"); eq(save.p_status, "connected");
  ok(!JSON.stringify(f.calls).includes("consumer-secret-123") && !JSON.stringify(f.calls).includes("passkey-passkey"), "secrets must not reach the database in plain form");
  ok(!JSON.stringify(out).includes("consumer") && logs.length === 0);
  eq(registered, { validation: "https://x.supabase.co/functions/v1/daraja-c2b-validate/LLTOKEN", confirmation: "https://x.supabase.co/functions/v1/daraja-c2b-confirm/LLTOKEN" });
});

Deno.test("connect: rejected keys or addresses are saved as failed with a safe reason, and bad input is refused", async () => {
  const f = fake({ get_payment_credentials: platformAccount });
  const bad = mkDaraja({ token: async () => { throw new Error("401"); } }).d;
  const r1 = await connectDaraja(payDeps(f, bad), "l1", KEYS);
  eq(r1.status, "failed"); eq(f.last("save_payment_credentials")!.p_cipher, null); eq(f.last("save_payment_credentials")!.p_status, "failed");
  const noReg = mkDaraja({ registerC2b: async () => { throw new Error("nope"); } }).d;
  eq((await connectDaraja(payDeps(fake({ get_payment_credentials: platformAccount }), noReg), "l1", KEYS)).status, "failed");
  for (const patch of [{ shortcode: "12" }, { shortcode: "12345a" }, { consumerKey: "short" }, { passkey: "has space in the passkey value 123" }, { consumerSecret: 5 }]) {
    await rejectsWith(() => connectDaraja(payDeps(fake({ get_payment_credentials: platformAccount }), mkDaraja().d), "l1", { ...KEYS, ...patch }), 400);
  }
  await rejectsWith(() => connectDaraja(payDeps(fake({ get_payment_credentials: () => ({ data: [] }) }), mkDaraja().d), "l1", KEYS), 404);
});

// ---------------- checking silent prompts ----------------
Deno.test("reconcile: silent prompts are settled from Safaricom's answer, and one failure does not stop the rest", async () => {
  const restore = quiet();
  const rows = [
    { kind: "tenant", id: "1", landlord_id: "l1", checkout: "c-paid", amount: 6500 }, { kind: "tenant", id: "2", landlord_id: "l1", checkout: "c-cancel", amount: 6500 },
    { kind: "platform", id: "3", landlord_id: "l1", checkout: "c-wait", amount: 1000 }, { kind: "platform", id: "4", landlord_id: "l1", checkout: "c-boom", amount: 1000 },
  ];
  const f = fake({ expire_old_attempts: () => ({ data: 2 }), pending_attempts: () => ({ data: rows }), get_payment_credentials: platformAccount, confirm_payment: () => ({ data: "led-1" }) });
  const notified: string[] = [];
  const { d } = mkDaraja({ stkQuery: async (_c, id) => { if (id === "c-boom") throw new Error("down"); return id === "c-paid" ? { resultCode: 0, resultDesc: "" } : id === "c-cancel" ? { resultCode: 1032, resultDesc: "cancelled" } : { resultCode: -1, resultDesc: "" }; } });
  const out = await reconcilePending(payDeps(f, d, notified));
  restore();
  eq(out, { confirmed: 1, failed: 1, waiting: 1, errors: 1, timedOut: 2 });
  eq(f.last("confirm_payment")!.p_receipt, "STKQ-c-paid"); eq(notified, ["led-1"]);
  eq(f.last("fail_payment_attempt")!.p_code, 1032);
});

// ---------------- SMS ----------------
const sms = (fail = false) => { const sent: { to: string; text: string }[] = []; return { sent, provider: { async send(to: string, text: string) { if (fail) throw new Error("Celcom down"); sent.push({ to, text }); return { id: "m1" }; } } }; };
const smsRpc = (status = "queued") => fake({ sms_charge: () => ({ data: "msg-1" }), sms_message_status: () => ({ data: status }) });

Deno.test("landlord SMS: sent and recorded; at zero balance nothing is sent; a provider failure refunds", async () => {
  const s = sms(); const f = smsRpc();
  eq(await sendLandlordSms({ rpc: f.rpc, sms: s.provider }, { landlordId: "l", template: "broadcast", phone: "0712345678", text: "Hello" }), "sent");
  eq(s.sent[0]!.to, "254712345678"); eq(f.last("sms_charge")!.p_segments, 1); eq(f.last("sms_mark_status")!.p_status, "sent"); eq(f.last("celcom_record_usage")!.p_segments, 1);
  const z = sms(); const paused = smsRpc("paused_insufficient_balance");
  eq(await sendLandlordSms({ rpc: paused.rpc, sms: z.provider }, { landlordId: "l", template: "broadcast", phone: "0712345678", text: "Hello" }), "paused");
  eq(z.sent.length, 0);
  const restore = quiet(); const bad = sms(true); const g = smsRpc();
  eq(await sendLandlordSms({ rpc: g.rpc, sms: bad.provider }, { landlordId: "l", template: "broadcast", phone: "0712345678", text: "Hello" }), "failed");
  restore(); eq(g.last("sms_provider_failed")!.p_message, "msg-1");
});

Deno.test("payment text: tells the tenant what was received, never blocks, and fails quietly at zero balance", async () => {
  const notice = { landlord_id: "l", tenancy_id: "t", phone: "0712345678", name: "Brian Otieno", amount: 6500, receipt: "RC123", balance: 0 };
  const s = sms(); const f = fake({ ledger_notice: () => ({ data: notice }), sms_charge: () => ({ data: "m" }), sms_message_status: () => ({ data: "queued" }) });
  await notifyPaid({ rpc: f.rpc, sms: s.provider }, "led");
  ok(s.sent[0]!.text.includes("KES 6500") && s.sent[0]!.text.includes("RC123") && s.sent[0]!.text.includes("paid up"));
  const z = sms(); const paused = fake({ ledger_notice: () => ({ data: notice }), sms_charge: () => ({ data: "m" }), sms_message_status: () => ({ data: "paused_insufficient_balance" }) });
  await notifyPaid({ rpc: paused.rpc, sms: z.provider }, "led"); eq(z.sent.length, 0);
  const restore = quiet();
  await notifyPaid({ rpc: (async () => { throw new Error("db down"); }) as unknown as Rpc, sms: s.provider }, "led");       // must not throw
  restore();
});

Deno.test("broadcast: charges first, stops when the wallet runs out, and reports what happened", async () => {
  const rs = Array.from({ length: 5 }, (_, i) => ({ tenancyId: `t${i}`, phone: `071200000${i}` }));
  let n = 0;
  const f = fake({ sms_charge: () => ({ data: `m${++n}` }), sms_message_status: (a) => ({ data: a.p_message === "m4" ? "paused_insufficient_balance" : "queued" }) });
  const s = sms();
  const out = await broadcast({ rpc: f.rpc, sms: s.provider }, { landlordId: "l", recipients: rs, message: "Water off tomorrow 9am to 1pm" });
  eq(out, { sent: 3, failed: 0, skipped: 2, paused: true });
  eq(s.sent.length, 3);
  await rejectsWith(() => broadcast({ rpc: f.rpc, sms: s.provider }, { landlordId: "l", recipients: rs, message: "  " }), 400);
  await rejectsWith(() => broadcast({ rpc: f.rpc, sms: s.provider }, { landlordId: "l", recipients: rs, message: "x".repeat(481) }), 400);
  await rejectsWith(() => broadcast({ rpc: f.rpc, sms: s.provider }, { landlordId: "l", recipients: [], message: "hi" }), 400);
  await rejectsWith(() => broadcast({ rpc: f.rpc, sms: s.provider }, { landlordId: "l", recipients: Array(101).fill(rs[0]!), message: "hi" }), 400);
});

Deno.test("reminders: sent once each, marked only when delivered, and always one segment", async () => {
  const rows = [
    { tenancy_id: "t1", landlord_id: "l1", phone: "0711111111", tenant_name: "Brian Otieno", balance: 6500, trigger: "2d" },
    { tenancy_id: "t2", landlord_id: "l2", phone: "0722222222", tenant_name: "Mary Wambui", balance: 12000, trigger: "overdue" },
  ];
  const f = fake({ due_reminders: () => ({ data: rows }), sms_charge: () => ({ data: "m" }), sms_message_status: () => ({ data: "queued" }) });
  const out = await runReminders({ rpc: f.rpc, sms: sms().provider }, "2026-11-03");
  eq(out, { sent: 2, failed: 0, paused: 0 });
  eq(f.calls.filter((c) => c.fn === "mark_reminder_sent").length, 2);
  eq(f.calls.filter((c) => c.fn === "sms_charge").map((c) => c.a.p_template), ["rent_reminder", "arrears"]);
  for (const t of ["7d", "4d", "2d", "1d", "due", "overdue"]) ok(reminderSms("Bartholomew-Maximilian", 100000, t).length <= 160, t);
  const paused = fake({ due_reminders: () => ({ data: rows }), sms_charge: () => ({ data: "m" }), sms_message_status: () => ({ data: "paused_insufficient_balance" }) });
  eq(await runReminders({ rpc: paused.rpc, sms: sms().provider }, "2026-11-03"), { sent: 0, failed: 0, paused: 2 });
  ok(!paused.names().includes("mark_reminder_sent"));
});

// ---------------- visitors ----------------
Deno.test("viewing request: valid contact details and preferences are submitted without a phone code", async () => {
  const good = { houseId: "123e4567-e89b-12d3-a456-426614174000", name: "Faith Njeri", phone: "0711222333", date: "2026-10-17", window: "Morning" };
  const ipHash = "a".repeat(64);
  const f = fake({ create_public_visit_request: () => ({ data: "req-1" }) });
  eq(await submitVisitRequest({ rpc: f.rpc, ipHash }, good), { ok: true });
  eq(f.last("create_public_visit_request")!.p_ip_hash, ipHash);
  eq(f.last("create_public_visit_request")!.p_phone, good.phone);
  for (const patch of [{ houseId: "nope" }, { name: "F" }, { phone: "123" }, { date: "tomorrow" }, { window: "Midnight" }])
    await rejectsWith(() => submitVisitRequest({ rpc: f.rpc, ipHash }, { ...good, ...patch }), 400);
  await rejectsWith(() => submitVisitRequest({ rpc: fake({ create_public_visit_request: () => ({ error: { code: "P0001", message: "Viewing requests are full for this house" } }) }).rpc, ipHash }, good), 400, /full for this house/);
});

// ---------------- invites ----------------
const info = { kind: "tenant", landlord_name: "Wanjiku Kamau", invitee_name: "Brian Otieno", invitee_phone: "0722111222", house_title: "Bedsitter B4", unit_label: "B4" };
Deno.test("invite: the link carries a secret that is stored only as a hash, and the landlord can share it if the SMS cannot be sent", async () => {
  const s = sms(); const f = fake({ create_invite: () => ({ data: "2026-10-23T00:00:00Z" }), invite_lookup: () => ({ data: info }), sms_charge: () => ({ data: "m" }), sms_message_status: () => ({ data: "queued" }) });
  const d = { rpc: f.rpc, sms: s.provider, appOrigin: "https://app.example.ke", pepper: "p" };
  const out = await createInvite(d, { landlordId: "l", kind: "tenant", tenancyId: "t1" });
  ok(out.link.startsWith("https://app.example.ke/invite/")); eq(out.smsSent, true);
  const token = out.link.split("/").pop()!;
  ok(!JSON.stringify(f.calls.filter((c) => c.fn === "create_invite")).includes(token), "the raw secret must never reach the database");
  ok(s.sent[0]!.text.includes(token));
  const paused = fake({ create_invite: () => ({ data: "x" }), invite_lookup: () => ({ data: info }), sms_charge: () => ({ data: "m" }), sms_message_status: () => ({ data: "paused_insufficient_balance" }) });
  const out2 = await createInvite({ ...d, rpc: paused.rpc }, { landlordId: "l", kind: "caretaker", houseId: "h", phone: "0722111222" });
  eq(out2.smsSent, false); ok(out2.link.length > 40);
  await rejectsWith(() => createInvite(d, { landlordId: "l", kind: "admin" }), 400);
  await rejectsWith(() => createInvite({ ...d, rpc: fake({ create_invite: () => ({ error: { code: "P0001", message: "This tenant has already joined" } }) }).rpc }, { landlordId: "l", kind: "tenant", tenancyId: "t" }), 400, /already joined/);
});

Deno.test("invite lookup: invalid links look the same as expired ones, and the phone is partly hidden", async () => {
  const f = fake({ invite_lookup: () => ({ data: info }) });
  const out = await lookupInvite({ rpc: f.rpc, pepper: "p" }, "x".repeat(43));
  eq(out.phoneHint, "0722 ••• 222"); ok(!JSON.stringify(out).includes("0722111222"));
  await rejectsWith(() => lookupInvite({ rpc: fake({ invite_lookup: () => ({ data: null }) }).rpc, pepper: "p" }, "x".repeat(43)), 404);
  await rejectsWith(() => lookupInvite({ rpc: f.rpc, pepper: "p" }, "short"), 404);
  await rejectsWith(() => lookupInvite({ rpc: f.rpc, pepper: "p" }, 12345), 404);
});

Deno.test("invite accept: strong password, the server picks the role, and a refused invite leaves no half-made account", async () => {
  const created: { email: string; kind: string }[] = []; const deleted: string[] = [];
  const mk = (accept: Handler, createUser?: (e: string, p: string, k: string) => Promise<string>) => {
    const f = fake({ invite_lookup: () => ({ data: info }), invite_accept: accept });
    return { f, d: { rpc: f.rpc, pepper: "p", createUser: createUser ?? (async (email: string, _p: string, kind: string) => { created.push({ email, kind }); return "user-1"; }), deleteUser: async (id: string) => { deleted.push(id); } } };
  };
  const good = { token: "t".repeat(43), email: "Brian@Example.ke", password: "goodpass1234" };
  const a = mk(() => ({ data: "tenant" }));
  eq(await acceptInvite(a.d, good), { ok: true, kind: "tenant" });
  eq(created, [{ email: "brian@example.ke", kind: "tenant" }]);
  for (const patch of [{ password: "short1" }, { password: "onlyletterslong" }, { password: "12345678901" }, { email: "nope" }]) await rejectsWith(() => acceptInvite(a.d, { ...good, ...patch }), 400);
  const b = mk(() => ({ error: { code: "P0001", message: "This tenant has already joined" } }));
  await rejectsWith(() => acceptInvite(b.d, good), 400, /already joined/);
  eq(deleted, ["user-1"]);
  const c = mk(() => ({ data: "tenant" }), async () => { throw new Error("exists"); });
  await rejectsWith(() => acceptInvite(c.d, good), 409);
});

// ---------------- scheduled jobs ----------------
Deno.test("cron: each task does its one job, using Nairobi's date, and unknown tasks are refused", async () => {
  const f = fake({ generate_charges: () => ({ data: 12 }), expire_subscriptions: () => ({ data: 3 }), create_due_payouts: () => ({ data: 2 }), due_reminders: () => ({ data: [] }), expire_old_attempts: () => ({ data: 0 }), pending_attempts: () => ({ data: [] }) });
  const deps = { rpc: f.rpc, pay: payDeps(f, mkDaraja().d), sms: { rpc: f.rpc, sms: sms().provider }, now: new Date("2026-10-31T22:30:00Z") };   // 01:30 on 1 November in Nairobi
  eq(await runCron("generate-charges", deps), { created: 12 });
  eq(f.last("generate_charges"), { p_year: 2026, p_month: 11 });
  eq(await runCron("expire-subscriptions", deps), { expired: 3 });
  eq(await runCron("payouts", deps), { payouts: 2 });
  await runCron("reminders", deps); eq(f.last("due_reminders"), { p_date: "2026-11-01" });
  eq(((await runCron("reconcile", deps)) as { errors: number }).errors, 0);
  await rejectsWith(() => runCron("drop-database", deps), 400);
});
