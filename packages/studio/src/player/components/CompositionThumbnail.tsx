import { memo, useCallback, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { useThumbnailStripSize } from "../../hooks/useThumbnailStripSize";
import {
  createThumbnailKey,
  type ThumbnailPriority,
  type ThumbnailRequest,
  readyImage,
} from "../lib/thumbnailScheduler";
import { TIMELINE_VIEWPORT_BUDGETS } from "../lib/timelineViewportBudgets";
import { ThumbnailTiles } from "./ThumbnailTiles";
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

// Tiles map onto a power-of-two grid from 0, at least one cell per tile; chunks follow the grid, so zooms reuse frames.
export function planCompositionStrip(
  sourceStart: number,
  sourceRangeDuration: number,
  tileSeconds: number,
) {
  const step = 2 ** Math.floor(Math.log2(Math.max(tileSeconds, MIN_FRAME_STEP_SECONDS)));
  const firstCell = Math.floor(sourceStart / step);
  const lastCell = Math.ceil((sourceStart + sourceRangeDuration) / step) - 1;
  const cellOf = (tile: number) =>
    Math.min(lastCell, Math.floor((sourceStart + (tile + 0.5) * tileSeconds) / step));
  const chunkStart = (chunk: number) => Math.max(chunk * STRIP_CHUNK_FRAMES, firstCell);
  const chunkEnd = (chunk: number) => Math.min((chunk + 1) * STRIP_CHUNK_FRAMES, lastCell + 1);
  return {
    times: (chunk: number) =>
      Array.from({ length: chunkEnd(chunk) - chunkStart(chunk) }, (_, i) =>
        Math.min(
          Math.max((chunkStart(chunk) + i + 0.5) * step, sourceStart),
          sourceStart + sourceRangeDuration - LAST_FRAME_INSET_SECONDS,
        ),
      ),
    tile: (tile: number) => {
      const cell = cellOf(tile);
      const chunk = Math.floor(cell / STRIP_CHUNK_FRAMES);
      return {
        chunk,
        frame: cell - chunkStart(chunk),
        frames: chunkEnd(chunk) - chunkStart(chunk),
      };
    },
  };
}

function stripUrls(
  plan: ReturnType<typeof planCompositionStrip>,
  options: Parameters<typeof buildCompositionThumbnailUrl>[0],
) {
  const urls = new Map<number, string>();
  return (chunk: number) => {
    const known = urls.get(chunk);
    if (known) return known;
    const built = buildCompositionThumbnailUrl({ ...options, times: plan.times(chunk) });
    urls.set(chunk, built);
    return built;
  };
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

interface TileImage {
  url: string;
  frame: number;
  frames: number;
}

interface CompositionTileProps extends TileImage {
  posterUrl: string;
  letterbox: boolean;
  projectId: string;
  sessionEpoch: number;
  priority: ThumbnailPriority;
  onAspect: (frameAspect: number) => void;
}

function useReadyImage(request: ThumbnailRequest | null) {
  return readyImage(useThumbnailLease(request));
}

type StripImage = NonNullable<ReturnType<typeof readyImage>>;

/** The tile's strip once ready; until then the one it showed last, kept leased so it stays decoded. */
function useShownStrip(cell: { request: ThumbnailRequest; frame: number; frames: number }) {
  const snapshot = useThumbnailLease(cell.request);
  const next = readyImage(snapshot);
  const [last, setLast] = useState<typeof cell | null>(null);
  if (next && last !== cell) setLast(cell);
  const held = useReadyImage(last && last.request);
  const source = next ? cell : last;
  const strip = next ?? held;
  return {
    shown: strip && source && { ...source, strip },
    freshAspect: next && next.aspect / cell.frames,
    failed: snapshot.status === "error",
  };
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

const CompositionTile = memo(function CompositionTile({
  url,
  posterUrl,
  frame,
  frames,
  letterbox,
  projectId,
  sessionEpoch,
  priority,
  onAspect,
}: CompositionTileProps) {
  const request = useMemo(
    () =>
      compositionThumbnailRequest(url, projectId, { sessionEpoch, priority, rich: true }, frames),
    [frames, priority, projectId, sessionEpoch, url],
  );
  const cell = useMemo(() => ({ request, frame, frames }), [frame, frames, request]);
  const { shown, freshAspect, failed } = useShownStrip(cell);
  const posterWhenStripFails = useMemo(
    () =>
      failed
        ? compositionThumbnailRequest(posterUrl, projectId, { sessionEpoch, priority, rich: true })
        : null,
    [failed, posterUrl, priority, projectId, sessionEpoch],
  );
  const poster = useReadyImage(posterWhenStripFails);
  const learned = poster ? poster.aspect : freshAspect;
  useLayoutEffect(() => {
    if (learned) onAspect(learned);
  }, [learned, onAspect]);
  if (poster) return <StripSlice strip={poster} frame={0} frames={1} letterbox={letterbox} />;
  return shown ? <StripSlice {...shown} letterbox={letterbox} /> : null;
});

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
  const aspect = learned?.url === url ? learned.aspect : null;
  const learnAspectOncePerRevision = useCallback(
    (next: number) => setLearned((known) => (known?.url === url ? known : { url, aspect: next })),
    [url],
  );
  const frameAspect = aspect ?? learned?.aspect ?? 16 / 9;
  const { frameW, frameCount } = computeThumbnailStrip(
    container.width,
    frameAspect,
    container.height,
    48,
  );
  const plan = useMemo(
    () =>
      sourceRangeDuration > 0 && container.width > 0
        ? planCompositionStrip(
            sourceStart,
            sourceRangeDuration,
            (sourceRangeDuration * frameW) / container.width,
          )
        : null,
    [container.width, frameW, sourceRangeDuration, sourceStart],
  );
  const stripUrlOf = useMemo(() => plan && stripUrls(plan, urlOptions), [plan, urlOptions]);
  const imageOf = (index: number): TileImage | null => {
    if (!plan || !stripUrlOf) return sourceRangeDuration > 0 ? null : { url, frame: 0, frames: 1 };
    const { chunk, frame, frames } = plan.tile(index);
    return { url: stripUrlOf(chunk), frame, frames };
  };

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
          const image = imageOf(index);
          return (
            <div
              key={index}
              className="relative h-full shrink-0 overflow-hidden"
              style={{ width: frameW }}
            >
              {image && (
                <CompositionTile
                  {...image}
                  posterUrl={url}
                  letterbox={frameW > Math.round(container.height * frameAspect)}
                  projectId={projectId}
                  sessionEpoch={sessionEpoch}
                  priority={priority}
                  onAspect={learnAspectOncePerRevision}
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
              textShadow: aspect ? "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" : "none",
            }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
