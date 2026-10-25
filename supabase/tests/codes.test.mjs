import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateCode, hashCode, isSixDigits, smsText } from "../functions/_shared/codes.ts";
import { toInternational, consoleProvider, providerFromEnv } from "../functions/_shared/sms.ts";

describe("phone code helpers", () => {
  it("codes are always six digits, including small numbers", () => {
    assert.equal(generateCode(() => new Uint32Array([5])), "000005");
    for (let i = 0; i < 2000; i++) assert.match(generateCode(), /^\d{6}$/);
  });
  it("biased high values are rejected and drawn again", () => {
    let calls = 0;
    const code = generateCode(() => new Uint32Array([calls++ === 0 ? 0xffffffff : 42]));
    assert.equal(code, "000042");
    assert.equal(calls, 2);
  });
  it("codes are spread evenly (a sanity check, not a proof)", () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) counts[Number(generateCode()[0])]++;
    for (const c of counts) assert.ok(c > 1500 && c < 2500, `digit count ${c} looks biased`);
  });
  it("the stored hash depends on the code, the person and the secret, and is not reversible to the code", async () => {
    const h = await hashCode("123456", "user-1", "pepper");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, await hashCode("123456", "user-1", "pepper"));
    assert.notEqual(h, await hashCode("123457", "user-1", "pepper"));
    assert.notEqual(h, await hashCode("123456", "user-2", "pepper"));
    assert.notEqual(h, await hashCode("123456", "user-1", "other"));
    assert.ok(!h.includes("123456"));
  });
  it("only exactly six digits are accepted from a browser", () => {
    for (const ok of ["000000", "123456"]) assert.equal(isSixDigits(ok), true);
    for (const bad of ["12345", "1234567", "12345a", " 123456", "", null, 123456, undefined, "１２３４５６"]) assert.equal(isSixDigits(bad), false);
  });
  it("the SMS fits one segment and carries the code", () => {
    const t = smsText("123456");
    assert.ok(t.includes("123456")); assert.ok(t.length <= 160);
  });
  it("phone numbers convert to international form and nonsense is refused", () => {
    assert.equal(toInternational("0712345678"), "254712345678");
    assert.equal(toInternational("0112345678"), "254112345678");
    for (const bad of ["712345678", "+254712345678", "0812345678", "07123", ""]) assert.throws(() => toInternational(bad));
  });
  it("the SMS provider is chosen explicitly and unknown names are refused", async () => {
    assert.deepEqual(await consoleProvider().send("254712345678", "x"), { id: "console" });
    assert.throws(() => providerFromEnv((k) => (k === "SMS_PROVIDER" ? "carrier-pigeon" : undefined)), /Unknown SMS_PROVIDER/);
    await assert.rejects(providerFromEnv(() => undefined).send("254712345678", "x"), /Missing setting/);
  });
});
