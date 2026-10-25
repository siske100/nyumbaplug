import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "../../../supabase/tests/helpers.mjs";
import { priceForUnits, priceFormula } from "../src/pricing.ts";

describe("pricing", () => {
  it("matches the agreed plan", () => {
    assert.equal(priceForUnits(0), 1000); assert.equal(priceForUnits(20), 1000);
    assert.equal(priceForUnits(21), 1015); assert.equal(priceForUnits(25), 1075); assert.equal(priceForUnits(100), 2200);
  });
  it("explains the sum in words", () => {
    assert.equal(priceFormula(25), "25 houses: 1,000 + 5 × 15 = 1,075");
    assert.equal(priceFormula(8), "8 houses (20 included): 1,000");
    assert.equal(priceFormula(1), "1 house (20 included): 1,000");
  });
  it("the screen and the database always agree", async () => {
    const db = await freshDb();
    for (const u of [0, 1, 19, 20, 21, 22, 40, 99, 250]) {
      const [{ p }] = (await db.query("select price_for_units($1) p", [u])).rows.map((r) => ({ p: r.p }));
      assert.equal(p, priceForUnits(u), `units ${u}`);
    }
  });
});
