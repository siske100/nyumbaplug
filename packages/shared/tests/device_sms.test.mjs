import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { choosePerf, smsSegments, smsCost } from "../src/index.ts";

describe("device profile", () => {
  it("weak phones, data saver and reduced-motion settings get the light version", () => {
    assert.equal(choosePerf({ memoryGb: 2, cores: 8, finePointer: true }), "lite");
    assert.equal(choosePerf({ memoryGb: 4, cores: 2 }), "lite");
    assert.equal(choosePerf({ memoryGb: 8, cores: 8, saveData: true, finePointer: true }), "lite");
    assert.equal(choosePerf({ memoryGb: 8, cores: 8, reducedMotion: true, finePointer: true }), "lite");
    assert.equal(choosePerf({ reducedTransparency: true }), "lite");
  });
  it("a normal phone gets standard, a strong desktop with a mouse gets rich, unknown devices are treated carefully", () => {
    assert.equal(choosePerf({ memoryGb: 4, cores: 8, finePointer: false }), "standard");
    assert.equal(choosePerf({ memoryGb: 8, cores: 12, finePointer: true }), "rich");
    assert.equal(choosePerf({ memoryGb: 8, cores: 12, finePointer: false }), "standard");     // strong but touch: no cursor effects
    assert.equal(choosePerf({}), "standard");
  });
  it("a choice the person made always wins", () => {
    assert.equal(choosePerf({ memoryGb: 1, override: "rich" }), "rich");
    assert.equal(choosePerf({ memoryGb: 16, cores: 16, finePointer: true, override: "lite" }), "lite");
  });
});

describe("SMS sizing on screen", () => {
  it("matches the server's counting", () => {
    assert.equal(smsSegments(""), 0); assert.equal(smsSegments("a".repeat(160)), 1); assert.equal(smsSegments("a".repeat(161)), 2);
    assert.equal(smsSegments("€".repeat(81)), 2); assert.equal(smsSegments("Habari 😀"), 1);
  });
  it("estimates the cost at KES 0.80 a segment per person", () => {
    assert.equal(smsCost("Water off tomorrow", 14), 11.2);
    assert.equal(smsCost("a".repeat(200), 3), 4.8);
  });
});
