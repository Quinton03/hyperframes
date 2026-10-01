import type { GsapAnimation } from "@hyperframes/core/gsap-parser";

/** A property's `[start, end]` as GSAP parsed it from the file when the tween first rendered. */
type Ends = Record<string, [number, number]>;

/** A GSAP 3 tween as the preview runtime holds it, with the property tweens the parse readers walk. */
export function liveTween(
  target: Element,
  tween: { start: number; duration: number; vars: Record<string, unknown>; ends?: Ends },
  { from = false, parts }: { from?: boolean; parts?: unknown[] } = {},
) {
  let head: Record<string, unknown> | undefined;
  for (const [p, [s, e]] of Object.entries(tween.ends ?? {}).reverse())
    head = from ? { p, s: e, c: s - e, _next: head } : { p, s, c: e - s, _next: head };
  return {
    targets: () => [target],
    startTime: () => tween.start,
    duration: () => tween.duration,
    vars: tween.vars,
    _from: from,
    ...(head && { _pt: { d: { _pt: head } } }),
    ...(parts && { timeline: { getChildren: () => parts } }),
  };
}

/** A preview iframe whose one timeline holds `tweens`, answering `getProperty` from `live`. */
export function previewWith(
  element: Element,
  tweens: unknown[],
  live: Record<string, number> = {},
): HTMLIFrameElement {
  return {
    contentWindow: {
      __timelines: { main: { getChildren: () => tweens, duration: () => 10 } },
      gsap: {
        getProperty: (_el: Element, prop: string) => live[prop] ?? 0,
        defaults: () => ({ ease: "power1.out" }),
      },
    },
    contentDocument: element.ownerDocument,
  } as unknown as HTMLIFrameElement;
}

export const tween = (fields: Partial<GsapAnimation>): GsapAnimation =>
  ({ targetSelector: "#box", propertyGroup: "position", ...fields }) as GsapAnimation;
