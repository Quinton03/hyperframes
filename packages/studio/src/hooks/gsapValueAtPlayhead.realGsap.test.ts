// @vitest-environment happy-dom
import { gsap } from "gsap";
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { replaceTweenWithKeyframesInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { afterEach, expect, it } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { parsedTweenEase } from "./gsapParsedTween";
import { planValueEdit } from "./gsapValueAtPlayhead";

/** Runs a composition script as the preview does: a paused timeline, bound, then seeked to `at`. */
function play(script: string, at: number) {
  const win = { __timelines: {} as Record<string, gsap.core.Timeline> };
  new Function("gsap", "window", script)(gsap, win);
  const timeline = win.__timelines.t!;
  timeline.progress(0.0001, true).seek(at);
  return { timeline, iframe: { contentWindow: { ...win, gsap } } as unknown as HTMLIFrameElement };
}

/** Drags `#x` to `x` at `at`, writes the plan into the script, and replays the written file there. */
function dragAndReplay(script: string, x: number, at: number) {
  const box = document.body.appendChild(document.createElement("div"));
  box.id = "x";
  const { timeline, iframe } = play(script, at);
  usePlayerStore.setState({ currentTime: at, activeKeyframePct: null });
  const anim = parseGsapScriptAcorn(script).animations[0]!;
  const selection = { id: "x", selector: "#x", element: box } as DomEditSelection;
  const plan = planValueEdit(selection, anim, { x }, iframe);
  timeline.kill();
  if (!plan.ok) return { plan };
  const written = replaceTweenWithKeyframesInScript(script, anim.id, plan.mutation)!;
  const replay = play(written, at);
  const shown = gsap.getProperty(box, "x");
  replay.timeline.kill();
  return { plan, written, shown };
}

const script = (vars: string) =>
  `var tl = gsap.timeline({ paused: true });\ntl.to("#x", { ${vars} }, 0);\nwindow.__timelines["t"] = tl;`;

afterEach(() => {
  document.body.replaceChildren();
  usePlayerStore.setState({ currentTime: 0, activeKeyframePct: null });
});

it("edits a delayed tween with no authored ease, landing the value at the playhead", () => {
  const { plan, shown } = dragAndReplay(script("duration: 1, delay: 0.5, x: 100"), 200, 2);
  expect(plan.ok).toBe(true);
  expect(shown).toBe(200);
});

it("writes a delayed linear tween so GSAP shows the new value at the playhead, not later", () => {
  const { shown } = dragAndReplay(script("duration: 1, delay: 0.5, x: 100, ease: 'none'"), 200, 2);
  expect(shown).toBe(200);
});

it("keeps GSAP's default ease, by name, for a tween that authors none", () => {
  const { plan } = dragAndReplay(script("duration: 1, x: 100"), 60, 0.5);
  expect(plan.ok && plan.mutation.easeEach).toBe("power1.out");
});

it("names only an ease GSAP built in, and refuses a custom function rather than guess", () => {
  const custom = { vars: { ease: (p: number) => p * p } };
  const iframe = { contentWindow: { gsap } } as unknown as HTMLIFrameElement;
  expect(parsedTweenEase(iframe, { vars: { ease: gsap.parseEase("expo.in") } })).toBe("expo.in");
  expect(parsedTweenEase(iframe, custom)).toBeNull();
});

it("writes an edit into a looping tween and keeps its repeat and yoyo, as main did", () => {
  const vars = "duration: 2, x: 100, ease: 'none', repeat: 1, yoyo: true";
  const { plan, written } = dragAndReplay(script(vars), 40, 1);
  expect(plan.ok).toBe(true);
  expect(written).toMatch(/repeat: 1[\s\S]*yoyo: true/);
});
