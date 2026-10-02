import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCssColor,
  hsvToRgb,
  mergeColorWithExistingAlpha,
  parseCssColor,
  rgbToHsv,
  toColorPickerValue,
  toHexColor,
} from "./colorValue";

describe("parseCssColor", () => {
  it("parses rgb values", () => {
    expect(parseCssColor("rgb(12, 34, 56)")).toEqual({
      red: 12,
      green: 34,
      blue: 56,
      alpha: 1,
    });
  });

  it("parses rgba values", () => {
    expect(parseCssColor("rgba(15, 23, 42, 0.64)")).toEqual({
      red: 15,
      green: 23,
      blue: 42,
      alpha: 0.64,
    });
  });

  it.each([
    ["#0f172acc", { red: 15, green: 23, blue: 42, alpha: 0.8 }],
    ["#f008", { red: 255, green: 0, blue: 0, alpha: 136 / 255 }],
    ["rgb(255 0 0 / 50%)", { red: 255, green: 0, blue: 0, alpha: 0.5 }],
    ["rgb(100% 0% 0% / 0.001)", { red: 255, green: 0, blue: 0, alpha: 0.001 }],
  ])("parses %s without a browser", (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected);
  });

  it.each(["", "#12", "notacolor", "currentcolor", "none", "rgb(1..2, 3, 4)", "rgb(1. 2 3)"])(
    "rejects %s without a browser",
    (input) => {
      expect(parseCssColor(input)).toBeNull();
    },
  );

  describe("in a browser without relative colour syntax", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    it.each([
      ["red", { red: 255, green: 0, blue: 0, alpha: 1 }],
      ["hsl(210 40% 50%)", { red: 77, green: 128, blue: 179, alpha: 1 }],
      ["rgb(100%, 0%, 0%)", { red: 255, green: 0, blue: 0, alpha: 1 }],
      ["inherit", null],
    ])(
      "resolves %s from the canvas's legacy serialization, or null if it rejects it",
      async (input, expected) => {
        const legacy: Record<string, string> = {
          transparent: "rgba(0, 0, 0, 0)",
          white: "#ffffff",
          red: "#ff0000",
          "hsl(210 40% 50%)": "#4d80b3",
          "rgb(100%, 0%, 0%)": "#ff0000",
        };
        let fillStyle = "#000000";
        const context = {
          get fillStyle() {
            return fillStyle;
          },
          set fillStyle(next: string) {
            fillStyle = legacy[next] ?? fillStyle;
          },
        };
        vi.stubGlobal("CSS", { supports: () => true });
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
        vi.resetModules();
        const { parseCssColor: parseFresh } = await import("./colorValue");
        expect(parseFresh(input)).toEqual(expected);
      },
    );
  });

  it("parses transparent", () => {
    expect(parseCssColor("transparent")).toEqual({
      red: 0,
      green: 0,
      blue: 0,
      alpha: 0,
    });
  });
});

describe("toColorPickerValue", () => {
  it("converts css color to hex", () => {
    expect(toColorPickerValue("rgba(15, 23, 42, 0.64)")).toBe("#0f172a");
  });
});

describe("toHexColor", () => {
  it("formats rgb channels as hex", () => {
    expect(toHexColor({ red: 15, green: 23, blue: 42 })).toBe("#0f172a");
  });
});

describe("formatCssColor", () => {
  it("formats opaque colors as rgb", () => {
    expect(formatCssColor({ red: 18, green: 52, blue: 86, alpha: 1 })).toBe("rgb(18, 52, 86)");
  });

  it("formats translucent colors as rgba", () => {
    expect(formatCssColor({ red: 18, green: 52, blue: 86, alpha: 0.64 })).toBe(
      "rgba(18, 52, 86, 0.64)",
    );
  });
});

describe("rgb hsv conversion", () => {
  it("round-trips primary color values", () => {
    const hsv = rgbToHsv({ red: 47, green: 198, blue: 127 });
    expect(hsvToRgb(hsv)).toEqual({ red: 47, green: 198, blue: 127 });
  });
});

describe("mergeColorWithExistingAlpha", () => {
  it("preserves alpha when the previous color was translucent", () => {
    expect(mergeColorWithExistingAlpha("#123456", "rgba(15, 23, 42, 0.64)")).toBe(
      "rgba(18, 52, 86, 0.64)",
    );
  });

  it("returns rgb when the previous color was opaque", () => {
    expect(mergeColorWithExistingAlpha("#123456", "rgb(15, 23, 42)")).toBe("rgb(18, 52, 86)");
  });
});
