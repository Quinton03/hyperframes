// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { DomEditGroupPathOffsetCommit } from "../components/editor/domEditOverlayGestures";
import { usePlayerStore } from "../player/store/playerStore";
import { trackStudioEditBlocked } from "../utils/studioSaveDiagnostics";
import { mountReactHarness } from "./domSelectionTestHarness";
import { GSAP_EDIT_BLOCK_COPY } from "./gsapEditOutcome";
import { useGsapAwareEditing } from "./useGsapAwareEditing";
import { useGsapInteractionFailureTelemetry } from "./useGsapInteractionFailureTelemetry";

vi.mock("../utils/studioSaveDiagnostics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/studioSaveDiagnostics")>()),
  trackStudioEditBlocked: vi.fn(),
  trackStudioSaveFailure: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  usePlayerStore.setState({ autoKeyframeEnabled: true, currentTime: 1, activeKeyframePct: null });
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "__timelines");
});

const positionTween = (id: string, extra: Partial<GsapAnimation> = {}) =>
  ({
    id: `#${id}-to-0-position`,
    targetSelector: `#${id}`,
    propertyGroup: "position",
    method: "to",
    properties: { x: 100 },
    position: 0,
    resolvedStart: 0,
    duration: 2,
    ease: "none",
    ...extra,
  }) as unknown as GsapAnimation;

/** Three members GSAP is visibly moving, one `to` tween each in the file. */
function mountGroup(animations: GsapAnimation[]) {
  const elements = ["a", "b", "c"].map((id) => {
    const el = Object.assign(document.createElement("div"), { id });
    document.body.append(el);
    return el;
  });
  const live = elements.map((el) => ({
    targets: () => [el],
    vars: { x: 100, duration: 2 },
    duration: () => 2,
    startTime: () => 0,
  }));
  const timelines = { root: { getChildren: () => live, duration: () => 2 } };
  Reflect.set(window, "__timelines", timelines);
  const iframe = {
    contentWindow: { gsap: { getProperty: () => 0, set: vi.fn() }, __timelines: timelines },
    contentDocument: document,
  } as unknown as HTMLIFrameElement;
  const commitMutation = Object.assign(vi.fn().mockResolvedValue(undefined), {
    batch: vi.fn().mockResolvedValue(undefined),
  });
  const showToast = vi.fn();
  const stageElementPositionOffset = vi.fn(() => ({ save: vi.fn(), rollback: vi.fn() }));
  let groupCommit!: (updates: DomEditGroupPathOffsetCommit[]) => Promise<void>;
  function Harness() {
    groupCommit = useGsapAwareEditing({
      domEditSelection: null,
      selectedGsapAnimations: [],
      gsapCommitMutation: commitMutation,
      previewIframeRef: { current: iframe },
      showToast,
      bumpGsapCache: vi.fn(),
      makeFetchFallback: () => async () => animations,
      trackGsapInteractionFailure: useGsapInteractionFailureTelemetry("index.html", showToast),
      stageElementPositionOffset,
      handleDomBoxSizeCommit: vi.fn(),
      handleDomRotationCommit: vi.fn(),
      commitPositionPatchToHtml: vi.fn(),
      addGsapAnimation: vi.fn(),
      convertToKeyframes: vi.fn(),
      setArcPath: vi.fn(),
      updateArcSegment: vi.fn(),
    }).handleGsapAwareGroupPathOffsetCommit;
    return null;
  }
  const root = mountReactHarness(<Harness />);
  const updates = elements.map((element) => ({
    selection: {
      element,
      id: element.id,
      selector: `#${element.id}`,
    } as unknown as DomEditSelection,
    next: { x: 30, y: 0 },
  }));
  const written = () => [
    ...commitMutation.mock.calls.map((call) => call[1]),
    ...commitMutation.batch.mock.calls.flatMap(([calls]) =>
      calls.map((c: { mutation: unknown }) => c.mutation),
    ),
  ];
  return { elements, iframe, updates, groupCommit, commitMutation, written, showToast, root };
}

describe("a group drag plans every member before its first write", () => {
  it("refuses the whole group when one member's tween cannot take a keyframe", async () => {
    const h = mountGroup([
      positionTween("a"),
      positionTween("b", { extras: { repeat: 1 } } as Partial<GsapAnimation>),
      positionTween("c"),
    ]);
    const styles = h.elements.map((el) => el.getAttribute("style"));

    await expect(h.groupCommit(h.updates)).rejects.toMatchObject({
      name: "GsapEditBlockedError",
      reason: "keyframes-uneditable",
      detail: "tween-extras",
    });

    expect(h.written()).toEqual([]);
    expect(h.commitMutation.batch).not.toHaveBeenCalled();
    const gsap = (h.iframe.contentWindow as unknown as { gsap: { set: unknown } }).gsap;
    expect(gsap.set).not.toHaveBeenCalled();
    expect(h.elements.map((el) => el.getAttribute("style"))).toEqual(styles);
    expect(h.showToast).toHaveBeenCalledTimes(1);
    expect(h.showToast).toHaveBeenCalledWith(GSAP_EDIT_BLOCK_COPY["keyframes-uneditable"], "error");
    expect(trackStudioEditBlocked).toHaveBeenCalledTimes(1);
    expect(trackStudioEditBlocked).toHaveBeenCalledWith(expect.objectContaining({ targetId: "b" }));
    act(() => h.root.unmount());
  });

  it("writes every member when each plan holds", async () => {
    const h = mountGroup(["a", "b", "c"].map((id) => positionTween(id)));

    await h.groupCommit(h.updates);

    const ids = h.written().map((m) => (m as { animationId?: string }).animationId);
    expect(ids).toEqual(["#a-to-0-position", "#b-to-0-position", "#c-to-0-position"]);
    expect(h.showToast).not.toHaveBeenCalled();
    act(() => h.root.unmount());
  });
});
