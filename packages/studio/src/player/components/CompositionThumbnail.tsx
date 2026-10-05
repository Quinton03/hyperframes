import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useThumbnailStripSize } from "../../hooks/useThumbnailStripSize";
import {
  createThumbnailKey,
  type ThumbnailPriority,
  type ThumbnailRequest,
  readyImage,
  thumbnailScheduler,
} from "../lib/thumbnailScheduler";
import { TIMELINE_VIEWPORT_BUDGETS } from "../lib/timelineViewportBudgets";
import { ThumbnailTiles, visibleTileRange } from "./ThumbnailTiles";
import { computeThumbnailStrip, probeImageAspect } from "./thumbnailUtils";
import { studioApiFetch } from "../../utils/studioApiFetch";

interface CompositionThumbnailProps {
  previewUrl: string;
  label: string;
  labelColor: string;
  selector?: string;
  selectorIndex?: number;
  seekTime?: number;
  duration?: number;
  width?: number;
  height?: number;
  projectId?: string;
  sessionEpoch?: number;
  contentRevision?: number;
  priority?: ThumbnailPriority;
  rich?: boolean;
  sourceStart?: number;
  sourceRangeDuration?: number;
}

const THUMBNAIL_URL_VERSION = "v3";
export const THUMBNAIL_SEEK_TIME_SECONDS = 3;

export function resolveThumbnailSeekTime(durationSeconds: number | null | undefined): number {
  if (
    Number.isFinite(durationSeconds) &&
    durationSeconds != null &&
    durationSeconds > 0 &&
    durationSeconds <= THUMBNAIL_SEEK_TIME_SECONDS
  ) {
    return durationSeconds / 2;
  }

  return THUMBNAIL_SEEK_TIME_SECONDS;
}

export function buildCompositionThumbnailUrl({
  previewUrl,
  seekTime = 2,
  duration = 5,
  selector,
  selectorIndex,
  origin,
  output,
  contentRevision = 0,
  times,
}: {
  previewUrl: string;
  seekTime?: number;
  duration?: number;
  selector?: string;
  selectorIndex?: number;
  origin: string;
  /**
   * Capture density. Omitted, the route bounds the image to its preview cap —
   * right for the timeline, where thumbnails are small and numerous and their
   * decoded bytes are budgeted. `"source"` uses the composition's own dimensions.
   */
  output?: "source";
  contentRevision?: number;
  times?: readonly number[];
}): string {
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");
  const thumbnailUrl = new URL(thumbnailBase, origin);
  if (times) thumbnailUrl.searchParams.set("times", times.map((t) => t.toFixed(3)).join(","));
  else thumbnailUrl.searchParams.set("t", (seekTime + duration / 2).toFixed(2));
  thumbnailUrl.searchParams.set("v", THUMBNAIL_URL_VERSION);
  thumbnailUrl.searchParams.set("revision", String(contentRevision));
  if (output) thumbnailUrl.searchParams.set("output", output);
  if (selector) {
    thumbnailUrl.searchParams.set("selector", selector);
    if (selectorIndex != null && selectorIndex > 0) {
      thumbnailUrl.searchParams.set("selectorIndex", String(selectorIndex));
    }
  }
  return thumbnailUrl.toString();
}

const STRIP_CHUNK_FRAMES = 8;
const MIN_FRAME_STEP_SECONDS = 1 / 32;
const LAST_FRAME_INSET_SECONDS = 0.001;

const gridStepFor = (tileSeconds: number) =>
  2 ** Math.floor(Math.log2(Math.max(tileSeconds, MIN_FRAME_STEP_SECONDS)));

// Tiles map onto a power-of-two grid from 0, at least one cell per tile; chunks follow the grid, so zooms reuse frames.
function compositionStripGrid(sourceStart: number, sourceRangeDuration: number, step: number) {
  const firstCell = Math.floor(sourceStart / step);
  const lastCell = Math.ceil((sourceStart + sourceRangeDuration) / step) - 1;
  const chunkStart = (chunk: number) => Math.max(chunk * STRIP_CHUNK_FRAMES, firstCell);
  const chunkEnd = (chunk: number) => Math.min((chunk + 1) * STRIP_CHUNK_FRAMES, lastCell + 1);
  return {
    step,
    times: (chunk: number) =>
      Array.from({ length: chunkEnd(chunk) - chunkStart(chunk) }, (_, i) => {
        const cell = chunkStart(chunk) + i;
        const from = Math.max(cell * step, sourceStart);
        const to = Math.min((cell + 1) * step, sourceStart + sourceRangeDuration);
        return Math.min((from + to) / 2, to - LAST_FRAME_INSET_SECONDS);
      }),
    tileAt: (tileSeconds: number) => (tile: number) => {
      const cell = Math.min(
        lastCell,
        Math.floor((sourceStart + (tile + 0.5) * tileSeconds) / step),
      );
      const chunk = Math.floor(cell / STRIP_CHUNK_FRAMES);
      return {
        chunk,
        frame: cell - chunkStart(chunk),
        frames: chunkEnd(chunk) - chunkStart(chunk),
      };
    },
  };
}

export function planCompositionStrip(
  sourceStart: number,
  sourceRangeDuration: number,
  tileSeconds: number,
) {
  const grid = compositionStripGrid(sourceStart, sourceRangeDuration, gridStepFor(tileSeconds));
  return { times: grid.times, tile: grid.tileAt(tileSeconds) };
}

/** The composition a preview URL renders: `/preview/comp/<path>`, or the root for `/preview`. */
export function compositionPathOfPreviewUrl(previewUrl: string): string {
  const match = /\/preview\/comp\/([^?#]+)/.exec(previewUrl);
  return match?.[1] ? decodeURIComponent(match[1]) : "index.html";
}

export function compositionThumbnailRequest(
  url: string,
  projectId: string,
  { sessionEpoch = 0, priority = "visible", rich = false }: Partial<ThumbnailRequest> = {},
  frames = 1,
): ThumbnailRequest {
  return {
    key: createThumbnailKey({ kind: "composition", url }),
    projectId,
    sessionEpoch,
    kind: "composition",
    priority,
    rich,
    load: (signal: AbortSignal) => loadCompositionImage(url, signal, frames),
  };
}

async function loadCompositionImage(url: string, signal: AbortSignal, frames: number) {
  const response = await studioApiFetch(url, { signal });
  if (!response.ok) throw new Error(`Composition thumbnail failed (${response.status})`);
  const blob = await response.blob();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const aspect = await probeImageAspect(objectUrl, signal);
    return {
      value: { kind: "image" as const, url: objectUrl, aspect },
      weight:
        TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalWidth *
        TIMELINE_VIEWPORT_BUDGETS.posterMaxPhysicalHeight *
        4 *
        frames,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

type StripImage = NonNullable<ReturnType<typeof readyImage>>;
type ShownCell = { request: ThumbnailRequest; frame: number; frames: number };
type ShownTile = ShownCell & { strip: StripImage };

const imageOf = (request: ThumbnailRequest) => readyImage(thumbnailScheduler.getSnapshot(request));

/** A tile's own frame once ready; until then what it showed last, or the poster if its strip failed. */
function cellToShow(cell: ShownCell, last: ShownCell | undefined, posterCell: ShownCell) {
  if (imageOf(cell.request)) return cell;
  if (last && imageOf(last.request)) return last;
  return thumbnailScheduler.getSnapshot(cell.request).status === "error" ? posterCell : null;
}

function showTiles(
  [first, end]: readonly [number, number],
  cellAt: (index: number) => ShownCell | null,
  lastShown: ReadonlyMap<number, ShownCell>,
  posterCell: ShownCell,
) {
  const tiles = new Map<number, ShownTile>();
  const leased = new Set<ThumbnailRequest>();
  let freshAspect: number | null = null;
  for (let index = first; index < end; index++) {
    const cell = cellAt(index);
    if (!cell) continue;
    leased.add(cell.request);
    const shown = cellToShow(cell, lastShown.get(index), posterCell);
    if (!shown) continue;
    leased.add(shown.request);
    const strip = imageOf(shown.request);
    if (!strip) continue;
    tiles.set(index, { ...shown, strip });
    if (shown === cell || shown === posterCell) freshAspect ??= strip.aspect / shown.frames;
  }
  return { tiles, leased, freshAspect };
}

/** Holds a lease on exactly the given requests, re-rendering when any of them changes. */
function useThumbnailLeases(requests: ReadonlySet<ThumbnailRequest>) {
  const [, rerender] = useReducer((renders: number) => renders + 1, 0);
  const leases = useRef(new Map<ThumbnailRequest, { release(): void }>());
  useLayoutEffect(() => {
    const held = leases.current;
    for (const request of requests)
      if (!held.has(request)) held.set(request, thumbnailScheduler.acquire(request, rerender));
    for (const [request, lease] of held) {
      if (requests.has(request)) continue;
      lease.release();
      held.delete(request);
    }
  }, [requests]);
  useEffect(() => {
    const held = leases.current;
    return () => {
      for (const lease of held.values()) lease.release();
      held.clear();
    };
  }, []);
}

function StripSlice({
  strip,
  frame,
  frames,
  letterbox,
}: {
  strip: StripImage;
  frame: number;
  frames: number;
  letterbox: boolean;
}) {
  const slice = (
    <div
      data-strip-frame={frame}
      className={letterbox ? "h-full max-w-full" : "absolute inset-0"}
      style={{
        opacity: "var(--timeline-composition-thumbnail-opacity)",
        animation: "hf-thumb-fade 200ms ease-out",
        aspectRatio: letterbox ? String(strip.aspect / frames) : undefined,
        backgroundImage: `url(${strip.url})`,
        backgroundSize: `${frames * 100}% 100%`,
        backgroundPositionX: frames > 1 ? `${(frame / (frames - 1)) * 100}%` : "0%",
      }}
    />
  );
  return letterbox ? <div className="absolute inset-0 flex justify-center">{slice}</div> : slice;
}

/** Server-rendered composition frames, deduplicated and budgeted by project/session. */
export const CompositionThumbnail = memo(function CompositionThumbnail({
  previewUrl,
  label,
  labelColor,
  selector,
  selectorIndex,
  seekTime = 2,
  duration = 5,
  projectId = previewUrl,
  sessionEpoch = 0,
  contentRevision = 0,
  priority = "visible",
  sourceStart = 0,
  sourceRangeDuration = 0,
}: CompositionThumbnailProps) {
  const [container, setContainerRef, watchGap] = useThumbnailStripSize();
  const urlOptions = useMemo(
    () => ({
      previewUrl,
      seekTime,
      duration,
      selector,
      selectorIndex,
      origin: window.location.origin,
      contentRevision,
    }),
    [contentRevision, duration, previewUrl, seekTime, selector, selectorIndex],
  );
  const url = useMemo(() => buildCompositionThumbnailUrl(urlOptions), [urlOptions]);
  const [learned, setLearned] = useState<{ url: string; aspect: number } | null>(null);
  const learnAspectOncePerRevision = useCallback(
    (next: number) => setLearned((known) => (known?.url === url ? known : { url, aspect: next })),
    [url],
  );
  const frameAspect = learned?.aspect ?? 16 / 9;
  const { frameW, frameCount } = computeThumbnailStrip(
    container.width,
    frameAspect,
    container.height,
    48,
  );
  const measured = container.width > 0;
  const tileSeconds = measured ? (sourceRangeDuration * frameW) / container.width : 0;
  const step = gridStepFor(tileSeconds);
  const grid = useMemo(
    () =>
      sourceRangeDuration > 0 && measured
        ? compositionStripGrid(sourceStart, sourceRangeDuration, step)
        : null,
    [measured, sourceRangeDuration, sourceStart, step],
  );
  const posterCell = useMemo(
    () => ({
      request: compositionThumbnailRequest(url, projectId, { sessionEpoch, priority, rich: true }),
      frame: 0,
      frames: 1,
    }),
    [priority, projectId, sessionEpoch, url],
  );
  const chunkRequest = useMemo(() => {
    if (!grid) return null;
    const requests = new Map<number, ThumbnailRequest>();
    return (chunk: number, frames: number) => {
      let request = requests.get(chunk);
      if (!request) {
        const chunkUrl = buildCompositionThumbnailUrl({ ...urlOptions, times: grid.times(chunk) });
        request = compositionThumbnailRequest(
          chunkUrl,
          projectId,
          { sessionEpoch, priority, rich: true },
          frames,
        );
        requests.set(chunk, request);
      }
      return request;
    };
  }, [grid, priority, projectId, sessionEpoch, urlOptions]);
  const tileOf = grid?.tileAt(tileSeconds);
  const cellAt = (index: number): ShownCell | null => {
    if (!tileOf || !chunkRequest) return sourceRangeDuration > 0 ? null : posterCell;
    const { chunk, frame, frames } = tileOf(index);
    return { request: chunkRequest(chunk, frames), frame, frames };
  };
  const lastShown = useRef<ReadonlyMap<number, ShownCell>>(new Map());
  const { tiles, leased, freshAspect } = showTiles(
    visibleTileRange(container, frameW, frameCount),
    cellAt,
    lastShown.current,
    posterCell,
  );
  useThumbnailLeases(leased);
  useLayoutEffect(() => {
    lastShown.current = tiles;
  });
  useEffect(() => {
    if (freshAspect) learnAspectOncePerRevision(freshAspect);
  }, [freshAspect, learnAspectOncePerRevision]);
  const letterbox = frameW > Math.round(container.height * frameAspect);

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      <ThumbnailTiles
        strip={container}
        frameW={frameW}
        frameCount={frameCount}
        watchGap={watchGap}
        style={{
          mixBlendMode:
            "var(--timeline-composition-thumbnail-blend)" as CSSProperties["mixBlendMode"],
        }}
      >
        {(index) => {
          const tile = tiles.get(index);
          return (
            <div
              key={index}
              className="relative h-full shrink-0 overflow-hidden"
              style={{ width: frameW }}
            >
              {tile && (
                <StripSlice
                  strip={tile.strip}
                  frame={tile.frame}
                  frames={tile.frames}
                  letterbox={letterbox}
                />
              )}
            </div>
          );
        }}
      </ThumbnailTiles>
      {label && (
        <div className="absolute inset-y-0 left-3 z-10 flex items-center">
          <span
            className="block max-w-full truncate text-[10px] font-semibold leading-none"
            style={{
              color: labelColor,
              textShadow: learned ? "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" : "none",
            }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
