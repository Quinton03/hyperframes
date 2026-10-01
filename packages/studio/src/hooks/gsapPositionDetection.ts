/**
 * GSAP position-write detection helpers for the drag bridge: read the live
 * runtime position from the preview iframe, and find/score the position
 * animation for a selector (and pick the tween closest to the playhead).
 *
 * Extracted from gsapRuntimeBridge.ts to keep that file under the size cap.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";
import { getIframeGsap, KEYFRAME_PCT_MATCH, queryIframeElement } from "./gsapShared";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";

// fallow-ignore-next-line complexity
export function readGsapPositionFromIframe(
  iframe: HTMLIFrameElement | null,
  elementSelector: string,
): { x: number; y: number } | null {
  const gsap = getIframeGsap(iframe);
  if (!gsap) return null;

  const element = queryIframeElement(iframe, elementSelector);
  if (!element) return null;

  const x = Number(gsap.getProperty(element, "x")) || 0;
  const y = Number(gsap.getProperty(element, "y")) || 0;
  return { x, y };
}

// fallow-ignore-next-line complexity
function animHasPosition(anim: GsapAnimation): boolean {
  if (anim.keyframes?.keyframes.some((kf) => "x" in kf.properties || "y" in kf.properties))
    return true;
  if (anim.method === "fromTo") {
    const from = anim.fromProperties;
    return (
      "x" in anim.properties || "y" in anim.properties || !!(from && ("x" in from || "y" in from))
    );
  }
  return "x" in anim.properties || "y" in anim.properties;
}

// fallow-ignore-next-line complexity
export function findGsapPositionAnimation(
  animations: GsapAnimation[],
  selector?: string,
): GsapAnimation | null {
  if (animations.length === 0) return null;
  const currentTime = usePlayerStore.getState().currentTime;

  const scored = animations.filter(animHasPosition).map((a) => {
    let score = 0;
    if (a.keyframes) score += 5;
    if (selector && a.targetSelector === selector) score += 8;
    else if (a.targetSelector.includes(",")) score -= 5;
    const pos = a.resolvedStart ?? (typeof a.position === "number" ? a.position : 0);
    const dur = a.duration ?? 0;
    if (currentTime >= pos - 0.05 && currentTime <= pos + dur + 0.05) score += 50;
    else
      score -= Math.round(
        Math.min(Math.abs(currentTime - pos), Math.abs(currentTime - pos - dur)) * 5,
      );
    return { anim: a, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.anim ?? null;
}

/** Whether the file states `anim`'s value at `time`; a tween's implicit start is GSAP's current value. */
function statesValueAt(anim: GsapAnimation, time: number): boolean {
  const duration = resolveTweenDuration(anim);
  if (!(duration > 0)) return false;
  const pct = ((time - (resolveTweenStart(anim) ?? 0)) / duration) * 100;
  const near = (keyframe: number) => Math.abs(keyframe - pct) <= KEYFRAME_PCT_MATCH;
  if (anim.keyframes) return anim.keyframes.keyframes.some((kf) => near(kf.percentage));
  if (anim.method === "from") return near(0);
  return near(100) || (anim.method === "fromTo" && near(0));
}

/**
 * From a set of candidate tweens, pick the one whose time range is closest to
 * the current playhead. A tween that *contains* the playhead wins outright;
 * otherwise the nearest endpoint wins. This ensures a drag at t=6s edits (or
 * extends) the 4s tween, not the 1.5s one. Ties: the one whose file states a value at the
 * playhead (the later one, which renders, if both do), then most keyframes.
 */
// fallow-ignore-next-line complexity
export function pickClosestToPlayhead(anims: GsapAnimation[]): GsapAnimation | null {
  if (anims.length <= 1) return anims[0] ?? null;
  const ct = usePlayerStore.getState().currentTime;
  return anims.reduce((best, a) => {
    const s = resolveTweenStart(a) ?? 0;
    const e = s + resolveTweenDuration(a);
    const dist = ct >= s && ct <= e ? 0 : Math.min(Math.abs(ct - s), Math.abs(ct - e));
    const bestS = resolveTweenStart(best) ?? 0;
    const bestE = bestS + resolveTweenDuration(best);
    const bestDist =
      ct >= bestS && ct <= bestE ? 0 : Math.min(Math.abs(ct - bestS), Math.abs(ct - bestE));
    if (dist < bestDist) return a;
    if (dist === 0 && bestDist === 0) {
      const [mine, theirs] = [statesValueAt(a, ct), statesValueAt(best, ct)];
      if (mine !== theirs) return mine ? a : best;
      if (mine && s !== bestS) return s > bestS ? a : best;
    }
    if (
      dist === bestDist &&
      (a.keyframes?.keyframes.length ?? 0) > (best.keyframes?.keyframes.length ?? 0)
    )
      return a;
    return best;
  });
}
