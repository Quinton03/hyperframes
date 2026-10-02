import { vi } from "vitest";

const CHROME_147_FILL_STYLE: Record<string, string> = {
  transparent: "rgba(0, 0, 0, 0)",
  white: "#ffffff",
  red: "#ff0000",
  currentcolor: "#000000",
  "hsl(210 40% 50%)": "#4d80b3",
  "rgb(100%, 0%, 0%)": "#ff0000",
  "hsl(0 100% 50% / 0.001)": "rgba(255, 0, 0, 0)",
  "oklch(0.7 0.15 200)": "oklch(0.7 0.15 200)",
  "oklch(0.7 0.15 200 / 0.25)": "oklch(0.7 0.15 200 / 0.25)",
  "color-mix(in oklab, oklch(0.7 0.15 200), red 50%)": "oklab(0.663983 0.0419629 0.0372782)",
  "color-mix(in srgb, #ff000000, #0000ffff 50%)": "color(srgb 0 0 1 / 0.5)",
};

const CHROME_147_RELATIVE_SRGB: Record<string, string> = {
  currentcolor: "color(srgb 0 0 0)",
  "hsl(0 100% 50% / 0.001)": "color(srgb 1 0 0 / 0.001)",
  "oklch(0.7 0.15 200)": "color(srgb -0.316663 0.724435 0.764448)",
  "oklch(0.7 0.15 200 / 0.25)": "color(srgb -0.316663 0.724435 0.764448 / 0.25)",
  "color-mix(in oklab, oklch(0.7 0.15 200), red 50%)": "color(srgb 0.698277 0.535308 0.473819)",
  "color-mix(in srgb, #ff000000, #0000ffff 50%)": "color(srgb 0 0 1 / 0.5)",
};

export async function loadColorModulesWithChromeCanvas() {
  let fillStyle = "#000000";
  const context = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(next: string) {
      const relative = /^color\(from (.+) srgb r g b \/ alpha\)$/.exec(next);
      fillStyle =
        (relative ? CHROME_147_RELATIVE_SRGB[relative[1]] : CHROME_147_FILL_STYLE[next]) ??
        fillStyle;
    },
  };
  vi.stubGlobal("CSS", { supports: () => true });
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
  vi.resetModules();
  return { ...(await import("./colorValue")), ...(await import("./gradientValue")) };
}
