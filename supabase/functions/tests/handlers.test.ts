import nodeAssert from "node:assert/strict";

// jsr.io is not reachable from every network, so the tests use Node's own assertions.
const assert = (cond: unknown, msg?: string) => nodeAssert.ok(cond, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
async function assertRejects(fn: () => Promise<unknown>, cls: new (...a: never[]) => Error): Promise<Error> {
  try { await fn(); } catch (e) { nodeAssert.ok(e instanceof cls, `expected ${cls.name}, got ${String(e)}`); return e as Error; }
  throw new Error("expected the call to fail");
}
import { handle } from "../_shared/http.ts";
import { hashCode } from "../_shared/codes.ts";
import { HttpError, sendPhoneCode, sendSubscriptionReminder, syncEmailVerified, verifyPhoneCode, type Rpc } from "../_shared/ops.ts";
import { reminderText, segmentsOf } from "../_shared/reminder.ts";

Deno.env.set("APP_ORIGIN", "https://app.example.ke");
const quiet = () => { const o = console.error; console.error = () => {}; return () => { console.error = o; }; };

function fakeRpc(results: Record<string, { data?: unknown; error?: { code?: string; message: string } }> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, args) => { calls.push({ fn, args }); const r = results[fn] ?? {}; return { data: r.data ?? null, error: r.error ?? null }; };
  return { rpc, calls };
}
const sms = () => { const sent: { to: string; text: string }[] = []; return { sent, provider: { async send(to: string, text: string) { sent.push({ to, text }); return { id: "1" }; } } }; };

Deno.test("send: the database stores only a hash, and the SMS carries the matching code", async () => {
  const { rpc, calls } = fakeRpc({ issue_phone_code: { data: "2026-10-15T10:05:00Z" } });
  const s = sms();
  const out = await sendPhoneCode("u1", { rpc, phoneOf: async () => "0712345678", sms: s.provider, pepper: "p", makeCode: () => "482913" });
  assertEquals(out, { expiresAt: "2026-10-15T10:05:00Z" });
  assertEquals(s.sent.length, 1);
  assertEquals(s.sent[0]!.to, "254712345678");
  assert(s.sent[0]!.text.includes("482913"));
  const stored = calls[0]!.args.p_code_hash as string;
  assertEquals(stored, await hashCode("482913", "u1", "p"));
  assert(!JSON.stringify(calls).includes("482913"), "the plain code must never be sent to the database");
  assertEquals(calls.map((c) => c.fn), ["issue_phone_code", "celcom_record_usage"]);       // the platform's SMS credit is tracked
});

Deno.test("send: a rate-limit message from the database reaches the person, and no SMS is sent", async () => {
  const { rpc } = fakeRpc({ issue_phone_code: { error: { code: "P0001", message: "Wait a minute before requesting another code" } } });
  const s = sms();
  const e = await assertRejects(() => sendPhoneCode("u1", { rpc, phoneOf: async () => "0712345678", sms: s.provider, pepper: "p" }), HttpError);
  assertEquals((e as HttpError).status, 400);
  assertEquals((e as HttpError).message, "Wait a minute before requesting another code");
  assertEquals(s.sent.length, 0);
});

Deno.test("send: unexpected database errors are hidden from the person", async () => {
  const restore = quiet();
  const { rpc } = fakeRpc({ issue_phone_code: { error: { code: "XX000", message: "relation secret_table does not exist" } } });
  const e = await assertRejects(() => sendPhoneCode("u1", { rpc, phoneOf: async () => "0712345678", sms: sms().provider, pepper: "p" }), HttpError);
  restore();
  assertEquals((e as HttpError).status, 500);
  assert(!(e as HttpError).message.includes("secret_table"));
});

Deno.test("send: if the SMS fails, the code is cancelled so nobody waits for nothing", async () => {
  const restore = quiet();
  const { rpc, calls } = fakeRpc();
  const failing = { async send(): Promise<{ id: string }> { throw new Error("Celcom down"); } };
  const e = await assertRejects(() => sendPhoneCode("u1", { rpc, phoneOf: async () => "0712345678", sms: failing, pepper: "p" }), HttpError);
  restore();
  assertEquals((e as HttpError).status, 502);
  assertEquals(calls.map((c) => c.fn), ["issue_phone_code", "cancel_phone_code"]);
});

Deno.test("verify: anything but six digits is refused before the database is touched", async () => {
  for (const bad of ["12345", "abcdef", "", 123456, null, undefined]) {
    const { rpc, calls } = fakeRpc();
    await assertRejects(() => verifyPhoneCode("u1", { code: bad }, { rpc, pepper: "p" }), HttpError);
    assertEquals(calls.length, 0);
  }
});

Deno.test("verify: right and wrong codes", async () => {
  const ok = fakeRpc({ verify_phone_code: { data: true } });
  assertEquals(await verifyPhoneCode("u1", { code: "123456" }, { rpc: ok.rpc, pepper: "p" }), { verified: true });
  assertEquals(ok.calls[0]!.args.p_code_hash, await hashCode("123456", "u1", "p"));
  const no = fakeRpc({ verify_phone_code: { data: false } });
  assertEquals(await verifyPhoneCode("u1", { code: "123456" }, { rpc: no.rpc, pepper: "p" }), { verified: false });
  const expired = fakeRpc({ verify_phone_code: { error: { code: "P0001", message: "No active code. Request a new one" } } });
  const e = await assertRejects(() => verifyPhoneCode("u1", { code: "123456" }, { rpc: expired.rpc, pepper: "p" }), HttpError);
  assertEquals((e as HttpError).message, "No active code. Request a new one");
});

Deno.test("email sync: only a confirmed email moves the account forward, and the fact comes from Auth", async () => {
  const stateOf = async () => "pending_phone";
  const { rpc, calls } = fakeRpc();
  const e1 = await assertRejects(() => syncEmailVerified("u1", { rpc, emailConfirmed: async () => false, stateOf }), HttpError);
  assertEquals((e1 as HttpError).status, 409);
  const e2 = await assertRejects(() => syncEmailVerified("u1", { rpc, emailConfirmed: async () => null, stateOf }), HttpError);
  assertEquals((e2 as HttpError).status, 401);
  assertEquals(calls.length, 0);
  assertEquals(await syncEmailVerified("u1", { rpc, emailConfirmed: async () => true, stateOf }), { state: "pending_phone" });
  assertEquals(calls[0]!.fn, "mark_contact_verified");
});

const call = (method: string, init: RequestInit = {}, fn: () => Promise<unknown> = async () => ({ ok: true })) =>
  handle(fn)(new Request("https://f.example/x", { method, ...init }));

Deno.test("web plumbing: preflight, methods and cross-site access", async () => {
  const pre = await call("OPTIONS", { headers: {
    Origin: "https://app.example.ke",
    "Access-Control-Request-Headers": "authorization, apikey, content-type, x-client-info",
  } });
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get("Access-Control-Allow-Origin"), "https://app.example.ke");
  assert((pre.headers.get("Access-Control-Allow-Headers") ?? "").split(", ").includes("x-client-info"));
  const evil = await call("OPTIONS", { headers: { Origin: "https://evil.example" } });
  assertEquals(evil.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals((await call("GET")).status, 405);
  const ok = await call("POST", { body: "{}" });
  assertEquals(ok.status, 200);
  assertEquals(ok.headers.get("Cache-Control"), "no-store");
});

Deno.test("web plumbing: errors show a safe message and never internals", async () => {
  const restore = quiet();
  const r = await call("POST", { body: "{}" }, async () => { throw new Error("password=hunter2 at db.internal:5432"); });
  restore();
  assertEquals(r.status, 500);
  const text = await r.text();
  assert(!text.includes("hunter2") && !text.includes("5432"));
  const h = await call("POST", { body: "{}" }, async () => { throw new HttpError(409, "Your email is not confirmed yet"); });
  assertEquals(h.status, 409);
});

const claimOk = (over: Record<string, unknown> = {}) => ({ claim_subscription_reminder: { data: { reminder_id: "r1", name: "Wanjiku Kamau", phone: "0712345678", price: 1125, days_left: 3, state: "active", ...over } } });

Deno.test("reminder: the landlord is texted, the claim is finished, and Celcom usage is recorded", async () => {
  const { rpc, calls } = fakeRpc(claimOk());
  const s = sms();
  assertEquals(await sendSubscriptionReminder("admin1", "land1", { rpc, sms: s.provider }), { sent: true });
  assertEquals(s.sent[0]!.to, "254712345678");
  assert(s.sent[0]!.text.includes("KES 1125") && s.sent[0]!.text.includes("3 days") && s.sent[0]!.text.startsWith("Hello Wanjiku"));
  assertEquals(calls.map((c) => c.fn), ["claim_subscription_reminder", "finish_subscription_reminder", "celcom_record_usage"]);
  assertEquals(calls[1]!.args.p_ok, true);
  assertEquals(calls[2]!.args.p_segments, 1);
});

Deno.test("reminder: the once-a-day rule from the database reaches the admin, and nothing is sent", async () => {
  const { rpc } = fakeRpc({ claim_subscription_reminder: { error: { code: "P0001", message: "A reminder was already sent in the last 24 hours" } } });
  const s = sms();
  const e = await assertRejects(() => sendSubscriptionReminder("a", "l", { rpc, sms: s.provider }), HttpError);
  assertEquals((e as HttpError).status, 400);
  assertEquals(s.sent.length, 0);
});

Deno.test("reminder: a failed SMS gives the daily allowance back and records no usage", async () => {
  const restore = quiet();
  const { rpc, calls } = fakeRpc(claimOk());
  const failing = { async send(): Promise<{ id: string }> { throw new Error("Celcom down"); } };
  const e = await assertRejects(() => sendSubscriptionReminder("a", "l", { rpc, sms: failing }), HttpError);
  restore();
  assertEquals((e as HttpError).status, 502);
  assertEquals(calls.map((c) => c.fn), ["claim_subscription_reminder", "finish_subscription_reminder"]);
  assertEquals(calls[1]!.args.p_ok, false);
});

Deno.test("reminder text: one segment, a safe name, and the right wording for expired accounts", () => {
  const cases = [
    { name: "Wanjiku Kamau", price: 1000, daysLeft: 30, state: "active" },
    { name: "Bartholomew-Maximilian Oluoch-Ochieng", price: 100000, daysLeft: 30, state: "active" },
    { name: null, price: 1125, daysLeft: 1, state: "active" },
    { name: "Mwangi", price: 1000, daysLeft: -2, state: "expired" },
  ];
  for (const c of cases) { const t = reminderText(c); assert(t.length <= 160, `too long: ${t.length}`); assertEquals(segmentsOf(t), 1); }
  assert(reminderText(cases[2]!).startsWith("Hello there,") && reminderText(cases[2]!).includes("1 day."));
  assert(reminderText(cases[3]!).includes("expired") && reminderText(cases[3]!).includes("0799326074"));
  assert(!reminderText({ name: "<script>alert(1)</script>", price: 1000, daysLeft: 5, state: "active" }).includes("<"));
});
