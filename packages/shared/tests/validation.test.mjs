import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, kenyanPhone, passwordSchema, landlordSignUpSchema, tenantSchema, houseSchema, viewingRequestSchema,
         nationalIdSchema, kraPinSchema, vacantUnitsSchema, isWithinNextDays, COUNTIES } from "../src/index.ts";

const ok = (schema, v) => schema.safeParse(v).success;

describe("shared validation", () => {
  it("there are exactly 47 counties", () => { assert.equal(COUNTIES.length, 47); assert.equal(new Set(COUNTIES).size, 47); });
  it("phones are normalised to one form and bad ones are refused", () => {
    assert.equal(normalizePhone("+254 712-345-678"), "0712345678");
    assert.equal(normalizePhone("254712345678"), "0712345678");
    assert.equal(kenyanPhone.parse("0712 345 678"), "0712345678");
    for (const bad of ["12345", "0812345678", "07123456789", "abc", ""]) assert.equal(ok(kenyanPhone, bad), false, bad);
  });
  it("passwords need length, letters and numbers, and must not be common", () => {
    assert.equal(ok(passwordSchema, "tenletters1"), true);
    for (const bad of ["short1a", "onlyletterslong", "1234567890", "password123"]) assert.equal(ok(passwordSchema, bad), false, bad);
  });
  it("landlord sign-up checks every field and returns a clean phone", () => {
    const r = landlordSignUpSchema.safeParse({ name: "Wanjiku Kamau", email: "w@x.ke", phone: "+254712345678", password: "goodpass123" });
    assert.equal(r.success, true); assert.equal(r.data.phone, "0712345678");
    assert.equal(ok(landlordSignUpSchema, { name: "W", email: "w@x.ke", phone: "0712345678", password: "goodpass123" }), false);
    assert.equal(ok(landlordSignUpSchema, { name: "Wanjiku", email: "not-an-email", phone: "0712345678", password: "goodpass123" }), false);
  });
  it("ID and KRA formats", () => {
    assert.equal(ok(nationalIdSchema, "31245678"), true); assert.equal(ok(nationalIdSchema, "123456"), false);
    assert.equal(kraPinSchema.parse(" a012345678z "), "A012345678Z"); assert.equal(ok(kraPinSchema, "B012345678Z"), false);
  });
  it("tenant records need an emergency contact who is a different person", () => {
    const base = { name: "Brian Otieno", phone: "0722111222", emergencyName: "Grace Otieno", emergencyPhone: "0733444555", emergencyRelationship: "mother", unitLabel: "B4" };
    assert.equal(ok(tenantSchema, base), true);
    assert.equal(ok(tenantSchema, { ...base, emergencyPhone: "0722 111 222" }), false);       // same number, different spacing
    assert.equal(ok(tenantSchema, { ...base, emergencyName: "" }), false);
    assert.equal(ok(tenantSchema, { ...base, emergencyRelationship: "" }), false);
  });
  it("houses: 3 to 7 photos, and vacant never above total", () => {
    const base = { title: "Bedsitters, Block B", county: "Bungoma", town: "Bungoma Town", type: "Bedsitter", rent: 6500, total: 8, vacant: 2, photos: 5 };
    assert.equal(ok(houseSchema, base), true);
    assert.equal(ok(houseSchema, { ...base, photos: 2 }), false);
    assert.equal(ok(houseSchema, { ...base, photos: 8 }), false);
    assert.equal(ok(houseSchema, { ...base, vacant: 9 }), false);
    assert.equal(ok(houseSchema, { ...base, county: "Atlantis" }), false);
    assert.equal(ok(vacantUnitsSchema, { vacant: 0, total: 4 }), true); assert.equal(ok(vacantUnitsSchema, { vacant: -1, total: 4 }), false);
  });
  it("viewing dates must fall inside the next 7 days", () => {
    const now = new Date(2026, 9, 14, 15, 30);
    assert.equal(isWithinNextDays("2026-10-14", 7, now), true);
    assert.equal(isWithinNextDays("2026-10-21", 7, now), true);
    assert.equal(isWithinNextDays("2026-10-22", 7, now), false);
    assert.equal(isWithinNextDays("2026-10-13", 7, now), false);
    assert.equal(isWithinNextDays("nonsense", 7, now), false);
    assert.equal(ok(viewingRequestSchema, { name: "Faith Njeri", phone: "0711222333", date: "2000-01-01", window: "Morning" }), false);
  });
});
