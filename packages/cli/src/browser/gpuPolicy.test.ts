import { describe, expect, it } from "vitest";
import { compositionUsesColorGrading, resolveLocalBrowserGpuMode } from "./gpuPolicy.js";

// compositionRequiresWebGpu and assertWebGpuAdapterAvailable are implemented
// in @hyperframes/engine (browserManager.ts) and only re-exported here — see
// that package's browserManager.test.ts for their coverage.
describe("local browser GPU policy", () => {
  it("defaults to auto and preserves explicit CLI/env overrides", () => {
    expect(resolveLocalBrowserGpuMode(undefined, undefined)).toBe("auto");
    expect(resolveLocalBrowserGpuMode(undefined, "hardware")).toBe("hardware");
    expect(resolveLocalBrowserGpuMode(undefined, "software")).toBe("software");
    expect(resolveLocalBrowserGpuMode(true, "software")).toBe("hardware");
    expect(resolveLocalBrowserGpuMode(false, "hardware")).toBe("software");
  });

  it("detects data-color-grading on any element, not just the composition root", () => {
    expect(
      compositionUsesColorGrading(
        '<div data-composition-id="main"><img data-color-grading=\'{"adjust":{"saturation":-1}}\' src="a.jpg" /></div>',
      ),
    ).toBe(true);
    expect(
      compositionUsesColorGrading('<div data-composition-id="main"><img src="a.jpg" /></div>'),
    ).toBe(false);
  });
});
