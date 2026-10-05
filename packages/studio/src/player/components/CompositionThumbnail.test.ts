// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockResizeObserver, reportResize } from "../../hooks/resizeObserverTestUtils";
import { thumbnailScheduler } from "../lib/thumbnailScheduler";
import {
  buildCompositionThumbnailUrl,
  CompositionThumbnail,
  planCompositionStrip,
} from "./CompositionThumbnail";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

class MockImage {
  static instances: MockImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";

  constructor() {
    MockImage.instances.push(this);
  }
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalImage = globalThis.Image;
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  globalThis.Image = MockImage as unknown as typeof Image;
  globalThis.fetch = vi.fn(async () => new Response(new Blob(["thumbnail"]), { status: 200 }));
  URL.createObjectURL = vi.fn(() => "blob:composition-thumbnail");
  URL.revokeObjectURL = vi.fn();
  MockImage.instances = [];
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  thumbnailScheduler.invalidateProject("/api/projects/demo/preview");
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.Image = originalImage;
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  document.body.replaceChildren();
});

describe("buildCompositionThumbnailUrl", () => {
  it("includes selector and occurrence index for precise element thumbnails", () => {
    expect(
      buildCompositionThumbnailUrl({
        previewUrl: "/api/projects/demo/preview",
        seekTime: 1,
        duration: 2,
        selector: ".card",
        selectorIndex: 2,
        origin: "http://localhost:3000",
      }),
    ).toBe(
      "http://localhost:3000/api/projects/demo/thumbnail/index.html?t=2.00&v=v3&revision=0&selector=.card&selectorIndex=2",
    );
  });

  it("asks for source density only when a caller opts in", () => {
    const base = {
      previewUrl: "/api/projects/demo/preview",
      seekTime: 1,
      duration: 0,
      origin: "http://localhost:3000",
    };

    expect(buildCompositionThumbnailUrl(base)).not.toContain("output=");
    expect(buildCompositionThumbnailUrl({ ...base, output: "source" })).toContain("output=source");
  });

  it("includes the persisted content revision in the cache identity", () => {
    const url = buildCompositionThumbnailUrl({
      previewUrl: "/api/projects/demo/preview",
      origin: "http://localhost:3000",
      contentRevision: 7,
    });

    expect(new URL(url).searchParams.get("revision")).toBe("7");
  });
});

describe("planCompositionStrip", () => {
  const timeOf = (plan: ReturnType<typeof planCompositionStrip>, tile: number) => {
    const { chunk, frame } = plan.tile(tile);
    return plan.times(chunk)[frame]!;
  };

  it.each([
    [0, 10, 1.25],
    [1.5, 7, 0.6],
    [0, 600, 18.4],
    [3, 0.2, 0.045],
    [0, 8, 1.136],
  ])(
    "gives each tile a later frame inside its own span (start %s, range %s, tile %s s)",
    (start, range, tile) => {
      const plan = planCompositionStrip(start, range, tile);
      const tiles = Math.ceil(range / tile);
      for (let i = 0; i < tiles; i++) {
        const time = timeOf(plan, i);
        const [from, to] = [start + i * tile, start + (i + 1) * tile];
        if (to <= start + range + 1e-9) {
          expect(time).toBeGreaterThanOrEqual(from);
          expect(time).toBeLessThanOrEqual(to);
          if (i > 0) expect(time).toBeGreaterThan(timeOf(plan, i - 1));
        } else {
          // The last tile runs past the clip's end and shows the clip's last frame.
          expect(time).toBeGreaterThan(start + range - tile);
          expect(time).toBeLessThan(start + range);
        }
      }
    },
  );

  it("asks a chunk for at most 8 ascending times", () => {
    const plan = planCompositionStrip(0, 600, 18.4);
    for (let tile = 0; tile < 33; tile++) {
      const times = plan.times(plan.tile(tile).chunk);
      expect(times.length).toBeLessThanOrEqual(8);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });

  it("asks for the same chunks at every zoom inside one power of two", () => {
    // A 6 s clip from 1.25 s at tiles from 0.86 s down to 0.5 s wide: a 0.5 s step throughout.
    const plans = [0.86, 0.67, 0.55, 0.5].map((tile) => planCompositionStrip(1.25, 6, tile));
    for (const chunk of [0, 1]) {
      expect(new Set(plans.map((plan) => String(plan.times(chunk)))).size).toBe(1);
    }
  });
});

describe("CompositionThumbnail", () => {
  async function renderThumbnail(): Promise<MockImage> {
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const probe = MockImage.instances[0];
    if (!probe) throw new Error("Expected an image probe");
    return probe;
  }

  it("renders visible tiles after the scheduled off-DOM probe loads", async () => {
    const probe = await renderThumbnail();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/demo/thumbnail/index.html"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(probe.src).toBe("blob:composition-thumbnail");

    await act(async () => {
      probe.naturalWidth = 1920;
      probe.naturalHeight = 1080;
      probe.onload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tiles = [...host.querySelectorAll("img")];
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => !tile.classList.contains("hidden"))).toBe(true);
    // Pictures read untinted by default, like video filmstrips; the theme tokens own any dimming.
    expect(
      tiles.every((tile) => tile.style.opacity === "var(--timeline-composition-thumbnail-opacity)"),
    ).toBe(true);
    expect(tiles[0]?.parentElement?.parentElement?.style.mixBlendMode).toBe(
      "var(--timeline-composition-thumbnail-blend)",
    );
  });

  it.each([
    { name: "a wide", width: 2700, height: 1000, tileWidth: 108 },
    { name: "a square", width: 1000, height: 1000, tileWidth: 48 },
    { name: "a portrait", width: 1080, height: 1920, tileWidth: 48 },
  ])(
    "shows $name picture whole at the clip's measured height",
    async ({ width, height, tileWidth }) => {
      Object.defineProperty(host, "clientWidth", { configurable: true, value: 500 });
      Object.defineProperty(host, "clientHeight", { configurable: true, value: 40 });
      const probe = await renderThumbnail();

      await act(async () => {
        probe.naturalWidth = width;
        probe.naturalHeight = height;
        probe.onload?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const img = host.querySelector("img")!;
      expect(img.parentElement?.style.width).toBe(`${tileWidth}px`);
      // A tile held at its minimum width letterboxes the picture instead of cropping it.
      expect(img.classList.contains("object-contain")).toBe(true);
    },
  );

  it("re-tiles at the height the resize observer reports", async () => {
    const probe = await renderThumbnail();
    await act(async () => {
      probe.naturalWidth = 2700;
      probe.naturalHeight = 1000;
      probe.onload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    act(() => reportResize(500, 40));

    expect(host.querySelector("img")?.parentElement?.style.width).toBe("108px");
  });

  it("draws nothing over the clip's own fill while its frames load", async () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(host.firstElementChild?.childElementCount).toBe(0);
  });

  it("aborts its scheduled off-DOM image probe when unmounted", async () => {
    const probe = await renderThumbnail();
    expect(host.querySelector("img")).toBeNull();
    expect(probe.src).toBe("blob:composition-thumbnail");

    await act(async () => {
      root?.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    root = null;

    expect(probe.onload).toBeNull();
    expect(probe.onerror).toBeNull();
    expect(probe.src).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:composition-thumbnail");
  });

  it("releases the old request and ignores its late result when persisted content changes", async () => {
    const signals: AbortSignal[] = [];
    const resolveFetches: Array<(response: Response) => void> = [];
    globalThis.fetch = vi.fn((_url, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>((resolve) => resolveFetches.push(resolve));
    });
    root = createRoot(host);

    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
          projectId: "demo",
          contentRevision: 0,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
          projectId: "demo",
          contentRevision: 1,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toContain(
      "revision=1",
    );

    await act(async () => {
      resolveFetches[0]?.(new Response(new Blob(["stale"]), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(MockImage.instances).toHaveLength(0);

    await act(async () => {
      resolveFetches[1]?.(new Response(new Blob(["fresh"]), { status: 200 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0]?.src).toBe("blob:composition-thumbnail");
  });

  it("shows each tile the frame the composition renders at that tile's time", async () => {
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 500 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 40 });
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
          sourceStart: 0,
          sourceRangeDuration: 8,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      const poster = MockImage.instances[0]!;
      poster.naturalWidth = 1920;
      poster.naturalHeight = 1080;
      poster.onload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) =>
      String(url),
    );
    const strips = urls.filter((url) => url.includes("times="));
    expect(strips).toHaveLength(1);
    expect(new URL(strips[0]!).searchParams.get("times")).toBe(
      "0.500,1.500,2.500,3.500,4.500,5.500,6.500,7.500",
    );

    await act(async () => {
      const strip = MockImage.instances[1]!;
      strip.naturalWidth = 8 * 240;
      strip.naturalHeight = 135;
      strip.onload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 500 px at 71 px tiles: 8 tiles of 1.136 s; the last runs past the 8 s clip and shows its last frame.
    const slices = [...host.querySelectorAll<HTMLElement>("[data-strip-frame]")];
    const frames = slices.map((slice) => Number(slice.dataset.stripFrame));
    expect(frames).toEqual([0, 1, 2, 3, 5, 6, 7, 7]);
    const times = new URL(strips[0]!).searchParams.get("times")!.split(",").map(Number);
    frames.slice(0, 7).forEach((frame, tile) => {
      const tileSeconds = (8 * 71) / 500;
      expect(times[frame]).toBeGreaterThanOrEqual(tile * tileSeconds);
      expect(times[frame]).toBeLessThanOrEqual((tile + 1) * tileSeconds);
    });
    // Each slice shows its own cell of the 8-frame strip, at one frame's aspect.
    slices.forEach((slice, tile) =>
      expect(slice.style.backgroundPositionX).toBe(`${(frames[tile]! / 7) * 100}%`),
    );
    // A tile exactly one frame wide is filled edge to edge, so neighbours meet without a seam.
    expect(slices.every((slice) => slice.style.aspectRatio === "")).toBe(true);
  });

  it("letterboxes a portrait frame at its own aspect in a tile held at the minimum width", async () => {
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 384 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 40 });
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
          sourceStart: 0,
          sourceRangeDuration: 8,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      const poster = MockImage.instances[0]!;
      poster.naturalWidth = 1080;
      poster.naturalHeight = 1920;
      poster.onload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      const strip = MockImage.instances[1]!;
      strip.naturalWidth = 8 * 76;
      strip.naturalHeight = 135;
      strip.onload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const slice = host.querySelector<HTMLElement>("[data-strip-frame]")!;
    expect(slice.parentElement?.parentElement?.style.width).toBe("48px");
    expect(parseFloat(slice.style.aspectRatio)).toBeCloseTo(76 / 135);
  });
});
