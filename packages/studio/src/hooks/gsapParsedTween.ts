import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { resolveTweenStart } from "../utils/globalTimeCompiler";
import type { ImplicitEndValue } from "./gsapValueAtPlayhead";

// GSAP 3 internals: a property tween in a tween's `_pt` chain; CSSPlugin keeps its own under `d._pt`.
interface PropTween {
  p?: string;
  s?: number;
  c?: number;
  d?: { _pt?: PropTween };
  _next?: PropTween;
}
interface ParsedTween {
  _pt?: PropTween;
  _from?: boolean;
  _initted?: boolean;
  vars?: Record<string, unknown>;
  parent?: {
    vars?: { defaults?: { ease?: unknown } };
    time?: () => number;
    seek?: (time: number, suppressEvents?: boolean) => unknown;
  };
  timeline?: { getChildren?: () => ParsedTween[] };
  targets?: () => Element[];
  startTime?: () => number;
  duration?: () => number;
}
interface GsapWindow {
  gsap?: {
    defaults?: () => { ease?: unknown };
    getProperty?: (target: Element, prop: string) => unknown;
    set?: (target: Element, vars: Record<string, unknown>) => void;
  };
  __timelines?: Record<string, { getChildren?: (nested: boolean) => ParsedTween[] }>;
}

// `scale` parses into the two longhands, which always share a start and end for a `scale` tween.
const PARSED_NAME: Record<string, string> = { scale: "scaleX", rotate: "rotation" };

function findPropTween(pt: PropTween | undefined, prop: string): PropTween | null {
  for (let node = pt; node; node = node._next) {
    if (node.p === prop && typeof node.s === "number" && typeof node.c === "number") return node;
    const nested = findPropTween(node.d?._pt, prop);
    if (nested) return nested;
  }
  return null;
}

/** `[start, end]` of `prop` in one initialised tween; a from() tween runs its pair backwards. */
function endsIn(tween: ParsedTween, prop: string): [number, number] | null {
  const pt = findPropTween(tween._pt, PARSED_NAME[prop] ?? prop);
  if (!pt) return null;
  const pair: [number, number] = [pt.s!, pt.s! + pt.c!];
  return tween._from ? [pair[1], pair[0]] : pair;
}

/** The live tween GSAP built from `anim`: same element, start and channels, parsed. */
// fallow-ignore-next-line complexity
export function findParsedTween(
  iframe: HTMLIFrameElement | null,
  element: Element,
  anim: GsapAnimation,
): ParsedTween | null {
  const win = iframe?.contentWindow as GsapWindow | null;
  const start = resolveTweenStart(anim);
  if (!win?.__timelines || start == null) return null;
  const props = Object.keys(anim.keyframes?.keyframes[0]?.properties ?? anim.properties);
  const keyframed = Boolean(anim.keyframes);
  for (const timeline of Object.values(win.__timelines)) {
    for (const tween of timeline?.getChildren?.(true) ?? []) {
      const targets = tween.targets?.() ?? [];
      if (!targets.includes(element) && !targets.some((t) => element.id && t.id === element.id))
        continue;
      if (Math.abs((tween.startTime?.() ?? Number.NaN) - start) > 1e-3) continue;
      const vars = tween.vars ?? {};
      const carries = keyframed ? "keyframes" in vars : props.some((p) => p in vars);
      if (!carries || !((tween.duration?.() ?? 0) > 0)) continue;
      parseUnplayed(win, element, tween, props);
      return tween;
    }
  }
  return null;
}

const TRANSFORM = ["x", "y", "rotation", "scaleX", "scaleY"];

/** GSAP parses a to() tween only when the playhead first passes it, and a soft reload resets that.
 *  Play it through and back with its channels cleared, as main's drag did, so a gesture's live
 *  `gsap.set` is not read as the authored start; then put back what the seek did not. */
function parseUnplayed(win: GsapWindow, element: Element, tween: ParsedTween, props: string[]) {
  const parts = tween.timeline?.getChildren?.() ?? [];
  if (tween._initted && parts.every((part) => part._initted)) return;
  const { parent } = tween;
  const gsap = win.gsap;
  if (!parent?.seek || !parent.time || !gsap?.getProperty || !gsap.set) return;
  const live = new Map(
    [...new Set([...props, ...TRANSFORM])].map((p) => [p, gsap.getProperty!(element, p)]),
  );
  const now = parent.time();
  gsap.set(element, { clearProps: props.join(",") });
  try {
    parent.seek((tween.startTime?.() ?? 0) + (tween.duration?.() ?? 0), true);
  } finally {
    parent.seek(now, true);
    const moved = [...live].filter(([p, v]) => v != null && gsap.getProperty!(element, p) !== v);
    if (moved.length > 0) gsap.set(element, Object.fromEntries(moved));
  }
}

/** Start and end values from GSAP's own parse of the tween, as loaded from the file. Null when
 *  GSAP has not initialised that part of the tween yet: the caller refuses rather than guess. */
export function parsedImplicitEndValue(tween: ParsedTween | null): ImplicitEndValue {
  return (prop, end) => {
    if (!tween) return null;
    for (const part of partsFrom(tween, end)) {
      const pair = endsIn(part, prop);
      if (pair) return end === "start" ? pair[0] : pair[1];
      // The nearest part animating `prop` is not initialised: an earlier one would be a wrong value.
      if (prop in (part.vars ?? {})) return null;
    }
    return null;
  };
}

/** A keyframed tween's parts, nearest `end` first; a flat tween is its own one part. */
function partsFrom(tween: ParsedTween, end: "start" | "end"): ParsedTween[] {
  const parts = tween.timeline?.getChildren?.() ?? [];
  if (parts.length === 0) return [tween];
  return end === "start" ? parts : [...parts].reverse();
}

/** The ease GSAP resolved for a flat tween that authors none: its timeline's default, else GSAP's. */
export function parsedTweenEase(iframe: HTMLIFrameElement | null, tween: ParsedTween | null) {
  if (!tween) return null;
  const win = iframe?.contentWindow as GsapWindow | null;
  const ease =
    tween.vars?.ease ?? tween.parent?.vars?.defaults?.ease ?? win?.gsap?.defaults?.().ease;
  return typeof ease === "string" ? ease : null;
}

/** An array of keyframe steps at the exact percentages GSAP times them; the parse rounds them. */
export function withExactStepTimes(anim: GsapAnimation, tween: ParsedTween | null): GsapAnimation {
  const data = anim.keyframes;
  const parts = tween?.timeline?.getChildren?.() ?? [];
  const total = tween?.duration?.() ?? 0;
  if (data?.format !== "object-array" || parts.length !== data.keyframes.length || !(total > 0))
    return anim;
  const ends = parts.map((part) => ((part.startTime?.() ?? 0) + (part.duration?.() ?? 0)) / total);
  if (ends.some((end) => !Number.isFinite(end))) return anim;
  const keyframes = data.keyframes.map((kf, i) => ({
    ...kf,
    percentage: Math.round(ends[i]! * 100000) / 1000,
  }));
  return { ...anim, keyframes: { ...data, keyframes } };
}
