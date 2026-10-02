// @vitest-environment happy-dom
import { parseGsapScriptAcornForWrite } from "@hyperframes/parsers/gsap-parser-acorn";
import { replaceTweenWithKeyframesInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { gsap } from "gsap";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Runs `script` with real GSAP and reads the box's x and opacity at `time`. */
function boxAt(script: string, time: number) {
  document.body.innerHTML = `<div id="entrance"></div>`;
  const tl = new Function("gsap", `${script}\nreturn tl;`)(gsap) as gsap.core.Timeline;
  tl.seek(time);
  const box = document.getElementById("entrance")!;
  const read = { x: gsap.getProperty(box, "x"), opacity: gsap.getProperty(box, "opacity") };
  tl.kill();
  return read;
}

describe("an entrance rewritten as keyframes at the playhead", () => {
  it.each([
    ["from()", `tl.from("#entrance", { x: -60, opacity: 0, duration: 1, ease: "none" }, 1);`],
    [
      "fromTo()",
      `tl.fromTo("#entrance", { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 1, ease: "none" }, 1);`,
    ],
  ])("still shows its start state before it starts, after a %s", (_, call) => {
    const script = `const tl = gsap.timeline({ paused: true });\n${call}`;
    const id = parseGsapScriptAcornForWrite(script)!.located[0]!.id;
    const edited = replaceTweenWithKeyframesInScript(script, id, {
      targetSelector: "#entrance",
      position: 1,
      duration: 1,
      keyframes: [
        { percentage: 0, properties: { x: -60, opacity: 0 } },
        { percentage: 50, properties: { x: -20, opacity: 0.5 } },
        { percentage: 100, properties: { x: 0, opacity: 1 } },
      ],
      easeEach: "none",
    })!;

    expect(boxAt(script, 0.5)).toEqual({ x: -60, opacity: 0 });
    expect(boxAt(edited, 0.5)).toEqual({ x: -60, opacity: 0 });
    expect(boxAt(edited, 1.5)).toEqual({ x: -20, opacity: 0.5 });
  });
});
