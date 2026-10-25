import nodeAssert from "node:assert/strict";
import { buildStkBody, createDaraja, nairobiTimestamp, parseC2b, parseStkCallback, stkPassword, toMsisdn, wholeShillings, DarajaError } from "../_shared/daraja.ts";
import { decryptJson, encryptJson, fromPgBytea, toPgBytea } from "../_shared/vault.ts";
import { clientIp, firstName, hmacHex, randomToken, safeEqual, smsSegments } from "../_shared/text.ts";

const eq = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const creds = { consumerKey: "ck", consumerSecret: "cs", shortcode: "174379", passkey: "pk" };

Deno.test("daraja: Nairobi time, password and body", () => {
  eq(nairobiTimestamp(new Date("2026-10-15T21:30:05Z")), "20261016003005");               // 21:30 UTC is 00:30 the next day in Nairobi
  eq(stkPassword("174379", "pk", "20261016003005"), btoa("174379pk20261016003005"));
  const b = buildStkBody(creds, { amount: 6500, msisdn: "254712345678", accountRef: "ABCDEF123456789", description: "Rent payment for the month", callbackUrl: "https://f/x" }, new Date("2026-10-15T21:30:05Z"));
  eq(b.AccountReference.length, 12); eq(b.TransactionDesc.length, 13); eq(b.Amount, 6500); eq(b.PartyB, "174379"); eq(b.TransactionType, "CustomerPayBillOnline");
  nodeAssert.throws(() => buildStkBody(creds, { amount: 0, msisdn: "254712345678", accountRef: "A", description: "R", callbackUrl: "x" }));
  nodeAssert.throws(() => buildStkBody(creds, { amount: 10.5, msisdn: "254712345678", accountRef: "A", description: "R", callbackUrl: "x" }));
  eq(toMsisdn("0712345678"), "254712345678"); nodeAssert.throws(() => toMsisdn("712345678"));
});

Deno.test("daraja: reading the STK callback", () => {
  const ok = { Body: { stkCallback: { MerchantRequestID: "m1", CheckoutRequestID: "ws_CO_1", ResultCode: 0, ResultDesc: "ok", CallbackMetadata: { Item: [
    { Name: "Amount", Value: 6500 }, { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" }, { Name: "TransactionDate", Value: 20261016003005 }, { Name: "PhoneNumber", Value: 254712345678 }] } } } };
  eq(parseStkCallback(ok), { checkoutRequestId: "ws_CO_1", merchantRequestId: "m1", resultCode: 0, resultDesc: "ok", receipt: "NLJ7RT61SV", amount: 6500, phone: "254712345678" });
  const cancelled = parseStkCallback({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: "c", ResultCode: 1032, ResultDesc: "Request cancelled by user" } } });
  eq(cancelled?.resultCode, 1032); eq(cancelled?.receipt, undefined);
  for (const bad of [null, {}, { Body: {} }, { Body: { stkCallback: { CheckoutRequestID: 5, ResultCode: 0 } } }, "text"]) eq(parseStkCallback(bad), null);
  eq(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "c", ResultCode: 0, CallbackMetadata: { Item: [{ Name: "MpesaReceiptNumber", Value: "<script>" }] } } } })?.receipt, undefined);
});

Deno.test("daraja: reading a manual Paybill payment", () => {
  eq(parseC2b({ TransID: "RKTQDM7W6S", TransAmount: "6500.00", BillRefNumber: " ab12cd34 ", MSISDN: "254712345678", BusinessShortCode: "600638" }),
     { receipt: "RKTQDM7W6S", amount: 6500, billRef: "ab12cd34", msisdn: "0712345678", shortcode: "600638" });
  eq(parseC2b({ TransID: "RKTQDM7W6S", TransAmount: "100", MSISDN: "a1b2c3hashedvalue" })?.msisdn, null);      // Safaricom now sends a hashed number
  for (const bad of [null, {}, { TransID: "x", TransAmount: "100" }, { TransID: "RKTQDM7W6S", TransAmount: "-5" }, { TransID: "RKTQDM7W6S", TransAmount: "abc" }]) eq(parseC2b(bad), null);
  eq(wholeShillings(6500), 6500); eq(wholeShillings(6500.4), 6501);
});

Deno.test("daraja client: token is cached, a push returns Safaricom's ids, and failures are safe", async () => {
  const log: string[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); log.push(u);
    if (u.includes("/oauth/")) { nodeAssert.ok(String((init?.headers as Record<string, string>).Authorization).startsWith("Basic ")); return new Response(JSON.stringify({ access_token: "T1", expires_in: "3599" })); }
    if (u.includes("processrequest")) return new Response(JSON.stringify({ ResponseCode: "0", CheckoutRequestID: "ws_CO_9", MerchantRequestID: "mr9" }));
    if (u.includes("query")) return new Response(JSON.stringify({ errorCode: "500.001.1001", errorMessage: "being processed" }), { status: 500 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const d = createDaraja("sandbox", fake);
  eq(await d.stkPush(creds, { amount: 100, msisdn: "254712345678", accountRef: "A", description: "R", callbackUrl: "https://f/x" }), { checkoutRequestId: "ws_CO_9", merchantRequestId: "mr9" });
  await d.stkPush(creds, { amount: 100, msisdn: "254712345678", accountRef: "A", description: "R", callbackUrl: "https://f/x" });
  eq(log.filter((u) => u.includes("/oauth/")).length, 1);
  eq((await d.stkQuery(creds, "ws_CO_9")).resultCode, -1);
  const refused = createDaraja("sandbox", (async () => new Response(JSON.stringify({ ResponseCode: "1", ResponseDescription: "bad" }))) as unknown as typeof fetch);
  let err: unknown; try { await refused.token({ consumerKey: "k", consumerSecret: "s" }); } catch (e) { err = e; }
  nodeAssert.ok(err instanceof DarajaError); nodeAssert.ok(!String((err as Error).message).includes("secret"));
});

Deno.test("vault: round trip, tamper detection, wrong key and wrong landlord all fail", async () => {
  const secret = { consumerKey: "k", consumerSecret: "s", passkey: "p" };
  const c = await encryptJson(secret, "landlord-1", KEY);
  eq(await decryptJson(c, "landlord-1", KEY), secret);
  nodeAssert.notDeepStrictEqual(c, await encryptJson(secret, "landlord-1", KEY));            // a fresh IV every time
  nodeAssert.ok(!new TextDecoder().decode(c).includes("consumerSecret"));
  const t = c.slice(); t[20] = t[20]! ^ 1;
  await nodeAssert.rejects(decryptJson(t, "landlord-1", KEY));
  await nodeAssert.rejects(decryptJson(c, "landlord-2", KEY));                              // moved to another landlord
  await nodeAssert.rejects(decryptJson(c, "landlord-1", btoa(String.fromCharCode(...new Uint8Array(32).fill(8)))));
  await nodeAssert.rejects(encryptJson(secret, "l", btoa("short")));
  eq(fromPgBytea(toPgBytea(c)), c);
});

Deno.test("text helpers: SMS sizing, safe compare, hashing, tokens", async () => {
  eq(smsSegments(""), 0); eq(smsSegments("a".repeat(160)), 1); eq(smsSegments("a".repeat(161)), 2); eq(smsSegments("a".repeat(306)), 2); eq(smsSegments("a".repeat(307)), 3);
  eq(smsSegments("€".repeat(80)), 1); eq(smsSegments("€".repeat(81)), 2);                  // € counts double in plain text
  eq(smsSegments("Habari 😀"), 1); eq(smsSegments("é".repeat(71) + "ẹ"), 2);                // a character outside the basic set switches the whole message to 70 per part
  nodeAssert.ok(safeEqual("abc", "abc")); nodeAssert.ok(!safeEqual("abc", "abd")); nodeAssert.ok(!safeEqual("abc", "abcd"));
  eq((await hmacHex("1.2.3.4", "p")).length, 64); nodeAssert.notEqual(await hmacHex("1.2.3.4", "p"), await hmacHex("1.2.3.5", "p"));
  eq(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" })), "9.9.9.9"); eq(clientIp(new Headers({ "cf-connecting-ip": "8.8.8.8", "x-forwarded-for": "9.9.9.9" })), "8.8.8.8"); eq(clientIp(new Headers()), "unknown");
  nodeAssert.match(randomToken(), /^[A-Za-z0-9_-]{43}$/); nodeAssert.notEqual(randomToken(), randomToken());
  eq(firstName("Wanjiku Kamau"), "Wanjiku"); eq(firstName(null), "there"); nodeAssert.ok(!/[<>\/]/.test(firstName("<b>x</b>")));
});
