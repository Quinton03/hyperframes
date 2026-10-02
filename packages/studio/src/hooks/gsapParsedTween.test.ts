// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parsedImplicitEndValue } from "./gsapParsedTween";
import { liveTween } from "./gsapParsedTween.test-helpers";

type Parsed = Parameters<typeof parsedImplicitEndValue>[0];
const el = document.createElement("div");
const part = (start: number, ends?: Record<string, [number, number]>) =>
  liveTween(el, { start, duration: 1, vars: { x: 0 }, ends });
const keyframed = (parts: unknown[]) =>
  liveTween(el, { start: 0, duration: 2, vars: { keyframes: [] } }, { parts }) as Parsed;

describe("parsedImplicitEndValue", () => {
  it("reads a flat tween's own start and end", () => {
    const value = parsedImplicitEndValue(part(0, { x: [-60, 0] }) as Parsed);
    expect([value("x", "start"), value("x", "end")]).toEqual([-60, 0]);
  });

  it("reads a keyframed tween's start from its first part and its end from its last", () => {
    const value = parsedImplicitEndValue(
      keyframed([part(0, { x: [0, 50] }), part(1, { x: [50, 120] })]),
    );
    expect([value("x", "start"), value("x", "end")]).toEqual([0, 120]);
  });

  it("refuses when the part nearest that end is not initialised, rather than read an earlier one", () => {
    const value = parsedImplicitEndValue(keyframed([part(0, { x: [0, 50] }), part(1)]));
    expect(value("x", "end")).toBeNull();
  });

  it("has no value without a parsed tween", () => {
    expect(parsedImplicitEndValue(null)("x", "start")).toBeNull();
  });
});
