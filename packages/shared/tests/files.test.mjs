import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sniffMime, validateKycFile, validatePhoto, KYC_MAX_BYTES } from "../src/files.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);

describe("document checks", () => {
  it("recognises JPG, PNG and PDF by their contents", () => {
    assert.equal(sniffMime(JPEG), "image/jpeg"); assert.equal(sniffMime(PNG), "image/png"); assert.equal(sniffMime(PDF), "application/pdf");
    assert.equal(sniffMime(EXE), null); assert.equal(sniffMime(new Uint8Array()), null);
  });
  it("accepts good files and reports a safe extension", () => {
    assert.deepEqual(validateKycFile({ size: 1000, type: "image/jpeg" }, JPEG), { ok: true, mime: "image/jpeg", ext: "jpg" });
    assert.deepEqual(validateKycFile({ size: 1000, type: "application/pdf" }, PDF), { ok: true, mime: "application/pdf", ext: "pdf" });
    assert.equal(validateKycFile({ size: 1000, type: "" }, PNG).ok, true);              // some browsers leave the type empty
  });
  it("refuses empty, oversized, disguised and unsupported files", () => {
    assert.equal(validateKycFile({ size: 0, type: "image/jpeg" }, JPEG).ok, false);
    assert.equal(validateKycFile({ size: KYC_MAX_BYTES + 1, type: "image/jpeg" }, JPEG).ok, false);
    assert.equal(validateKycFile({ size: KYC_MAX_BYTES, type: "image/jpeg" }, JPEG).ok, true);
    assert.equal(validateKycFile({ size: 1000, type: "image/jpeg" }, EXE).ok, false);   // an .exe renamed to .jpg
    assert.equal(validateKycFile({ size: 1000, type: "image/jpeg" }, PDF).ok, false);   // declared type disagrees with contents
    assert.equal(validateKycFile({ size: 1000, type: "application/msword" }, EXE).ok, false);
  });
  it("house photos accept JPG, PNG and WebP, and refuse PDFs, disguised files and big files", () => {
    const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    assert.deepEqual(validatePhoto({ size: 1000, type: "image/webp" }, WEBP), { ok: true, mime: "image/webp", ext: "webp" });
    assert.equal(validatePhoto({ size: 1000, type: "image/jpeg" }, JPEG).ok, true);
    assert.equal(validatePhoto({ size: 1000, type: "application/pdf" }, PDF).ok, false);
    assert.equal(validatePhoto({ size: 1000, type: "image/webp" }, JPEG).ok, false);
    assert.equal(validatePhoto({ size: KYC_MAX_BYTES + 1, type: "image/png" }, PNG).ok, false);
    assert.equal(validatePhoto({ size: 1000, type: "image/jpeg" }, EXE).ok, false);
  });
});
