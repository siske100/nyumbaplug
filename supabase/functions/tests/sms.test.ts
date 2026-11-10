import nodeAssert from "node:assert/strict";
import type { Rpc } from "../_shared/ops.ts";
import { runOutbox } from "../_shared/messaging.ts";
import { celcomProvider, CELCOM_URL } from "../_shared/sms.ts";
import { runCron } from "../_shared/cron.ts";

const eq = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
type Handler = (a: Record<string, unknown>) => { data?: unknown; error?: { code?: string; message: string } };
function fake(h: Record<string, Handler> = {}) {
  const calls: { fn: string; a: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, a) => { calls.push({ fn, a }); const r = h[fn]?.(a) ?? {}; return { data: r.data ?? null, error: r.error ?? null }; };
  return { rpc, calls, of: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.a) };
}
const msg = (over: Record<string, unknown> = {}) => ({ id: "m1", kind: "payout_paid", recipient_phone: "0712345678", body: "Hello Wanjiku, your payout of KES 6500 has been sent.", charge_landlord: null, tenancy_id: null, ...over });
const quiet = () => { const o = console.error; console.error = () => {}; return () => { console.error = o; }; };

Deno.test("celcom: posts the documented fields to the documented address and reads the message id", async () => {
  let seen: { url: string; body: Record<string, string> } | undefined;
  const get = (k: string) => ({ CELCOM_PARTNER_ID: "77", CELCOM_API_KEY: "key", CELCOM_SHORTCODE: "INFOTEXT" } as Record<string, string>)[k];
  const ok = celcomProvider(get, (async (u: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(u), body: JSON.parse(String(init!.body)) };
    return new Response(JSON.stringify({ responses: [{ "response-code": 200, "response-description": "Success", messageid: 5551 }] }), { status: 200 });
  }) as typeof fetch);
  eq(await ok.send("254712345678", "Hi"), { id: "5551" });
  eq(seen, { url: CELCOM_URL, body: { partnerID: "77", apikey: "key", shortcode: "INFOTEXT", mobile: "254712345678", message: "Hi", pass_type: "plain" } });
  eq(CELCOM_URL, "https://isms.celcomafrica.com/api/services/sendsms/");
});

Deno.test("celcom: every failure is an error that says what to do, and a missing setting is named", async () => {
  const get = (k: string) => ({ CELCOM_PARTNER_ID: "77", CELCOM_API_KEY: "key", CELCOM_SHORTCODE: "INFOTEXT" } as Record<string, string>)[k];
  const respond = (status: number, body: unknown) => celcomProvider(get, (async () => new Response(JSON.stringify(body), { status })) as typeof fetch);
  const fails = async (p: ReturnType<typeof celcomProvider>, text: RegExp) => { try { await p.send("254712345678", "x"); throw new Error("no"); } catch (e) { nodeAssert.match((e as Error).message, text); } };
  await fails(respond(200, { responses: [{ "response-code": 1004 }] }), /top up the Celcom account/);
  await fails(respond(200, { responses: [{ "response-code": 1006 }] }), /credentials are invalid/);
  await fails(respond(200, { responses: [{ "response-code": 4090 }] }), /retried/);
  await fails(respond(200, { responses: [{ "response-code": 1007 }] }), /code 1007/);
  await fails(respond(500, { nothing: true }), /HTTP 500/);
  await fails(respond(200, "not json"), /code none/);
  await fails(celcomProvider((k) => (k === "CELCOM_API_KEY" ? undefined : "x"), (async () => new Response("{}")) as typeof fetch), /Missing setting CELCOM_API_KEY/);
});

Deno.test("outbox: a text about the landlord's own money is sent at our cost, recorded as usage, and marked sent", async () => {
  const f = fake({ outbox_claim: () => ({ data: [msg()] }) });
  const sent: string[][] = [];
  const out = await runOutbox({ rpc: f.rpc, sms: { send: async (to, text) => { sent.push([to, text]); return { id: "x" }; } } });
  eq(out, { sent: 1, failed: 0, paused: 0 });
  eq(sent, [["254712345678", "Hello Wanjiku, your payout of KES 6500 has been sent."]]);
  eq(f.of("celcom_record_usage"), [{ p_segments: 1, p_purpose: "notice" }]);
  eq(f.of("outbox_mark"), [{ p_id: "m1", p_status: "sent" }]);
  eq(f.of("sms_charge").length, 0);                                    // the landlord's wallet is untouched
});

Deno.test("outbox: a text to a tenant is charged to that landlord's wallet, refunded if it fails, and left alone when the wallet is empty", async () => {
  const claim = msg({ id: "t1", kind: "claim_received", charge_landlord: "ll-1", tenancy_id: "ten-1", recipient_phone: "0722000111", body: "Hello Brian, your landlord confirmed your payment." });
  const ok = fake({ outbox_claim: () => ({ data: [claim] }), sms_charge: () => ({ data: "sms-1" }), sms_message_status: () => ({ data: "queued" }) });
  eq(await runOutbox({ rpc: ok.rpc, sms: { send: async () => ({ id: "z" }) } }), { sent: 1, failed: 0, paused: 0 });
  eq(ok.of("sms_charge")[0], { p_landlord: "ll-1", p_template: "payment_confirmed", p_recipient: "0722000111", p_body: claim.body, p_segments: 1, p_tenancy: "ten-1" });

  const restore = quiet();
  const broken = fake({ outbox_claim: () => ({ data: [claim] }), sms_charge: () => ({ data: "sms-2" }), sms_message_status: () => ({ data: "queued" }) });
  eq(await runOutbox({ rpc: broken.rpc, sms: { send: async () => { throw new Error("down"); } } }), { sent: 0, failed: 1, paused: 0 });
  eq(broken.of("sms_provider_failed").length, 1);                       // the landlord gets the money back
  eq(broken.of("outbox_mark"), [{ p_id: "t1", p_status: "failed" }]);   // and the database queues it for another try

  const empty = fake({ outbox_claim: () => ({ data: [{ ...claim, kind: "claim_rejected" }] }), sms_charge: () => ({ data: "sms-3" }), sms_message_status: () => ({ data: "paused_insufficient_balance" }) });
  const sends: string[] = [];
  eq(await runOutbox({ rpc: empty.rpc, sms: { send: async (to) => { sends.push(to); return { id: "q" }; } } }), { sent: 0, failed: 0, paused: 1 });
  restore();
  eq(sends, []); eq(empty.of("sms_charge")[0].p_template, "broadcast");
});

Deno.test("outbox: one bad message never stops the rest, and an empty queue does nothing", async () => {
  const restore = quiet();
  const f = fake({ outbox_claim: () => ({ data: [msg({ id: "a", recipient_phone: "bad" }), msg({ id: "b" })] }) });
  eq(await runOutbox({ rpc: f.rpc, sms: { send: async () => ({ id: "ok" }) } }), { sent: 1, failed: 1, paused: 0 });
  restore();
  eq(f.of("outbox_mark"), [{ p_id: "a", p_status: "failed" }, { p_id: "b", p_status: "sent" }]);
  const none = fake({ outbox_claim: () => ({ data: [] }) });
  eq(await runOutbox({ rpc: none.rpc, sms: { send: async () => ({ id: "n" }) } }), { sent: 0, failed: 0, paused: 0 });
});

Deno.test("cron: the outbox task runs the sender", async () => {
  const f = fake({ outbox_claim: () => ({ data: [msg()] }) });
  const sms = { rpc: f.rpc, sms: { send: async () => ({ id: "c" }) } };
  eq(await runCron("outbox", { rpc: f.rpc, pay: {} as never, sms }), { sent: 1, failed: 0, paused: 0 });
});
