import { memo, useMemo, type CSSProperties } from "react";
import { useThumbnailLease } from "../../hooks/useThumbnailLease";
import { useThumbnailStripSize } from "../../hooks/useThumbnailStripSize";
import {
  createThumbnailKey,
  type ThumbnailPriority,
  type ThumbnailRequest,
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
}): string {
  const thumbnailBase = previewUrl
    .replace("/preview/comp/", "/thumbnail/")
    .replace(/\/preview$/, "/thumbnail/index.html");
  const thumbnailUrl = new URL(thumbnailBase, origin);
  thumbnailUrl.searchParams.set("t", (seekTime + duration / 2).toFixed(2));
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

// Tiles map onto a power-of-two time grid from 0, no finer than a tile: distinct neighbours, frames reused on zoom.
export function planCompositionStrip(
  sourceStart: number,
  sourceRangeDuration: number,
  tileSeconds: number,
) {
  const step = 2 ** Math.floor(Math.log2(Math.max(tileSeconds, MIN_FRAME_STEP_SECONDS)));
  // From the clip's range alone, so a chunk changes only with the step, never with the zoom inside it.
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

export function buildCompositionStripUrl(posterUrl: string, times: readonly number[]): string {
  const url = new URL(posterUrl);
  url.searchParams.delete("t");
  url.searchParams.set("times", times.map((t) => t.toFixed(3)).join(","));
  return url.toString();
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

interface CompositionTileProps {
  posterUrl: string;
  stripUrl: string | null;
  frame: number;
  frames: number;
  projectId: string;
  sessionEpoch: number;
  priority: ThumbnailPriority;
}

const CompositionTile = memo(function CompositionTile({
  posterUrl,
  stripUrl,
  frame,
  frames,
  projectId,
  sessionEpoch,
  priority,
}: CompositionTileProps) {
  const request = useMemo(
    () =>
      stripUrl &&
      compositionThumbnailRequest(
        stripUrl,
        projectId,
        { sessionEpoch, priority, rich: true },
        frames,
      ),
    [frames, priority, projectId, sessionEpoch, stripUrl],
  );
  const snapshot = useThumbnailLease(request || null);
  const strip =
    snapshot.status === "ready" && snapshot.value.kind === "image" ? snapshot.value : null;
  const opacity = "var(--timeline-composition-thumbnail-opacity)";
  if (!strip) {
    return (
      <img
        src={posterUrl}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
        style={{ opacity }}
      />
    );
  }
  return (
    <div className="absolute inset-0 flex justify-center">
      <div
        data-strip-frame={frame}
        className="h-full max-w-full"
        style={{
          opacity,
          aspectRatio: String(strip.aspect / frames),
          backgroundImage: `url(${strip.url})`,
          backgroundSize: `${frames * 100}% 100%`,
          backgroundPositionX: frames > 1 ? `${(frame / (frames - 1)) * 100}%` : "0%",
        }}
      />
    </div>
  );
});

/** Server-rendered composition poster, deduplicated and budgeted by project/session. */
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
  const url = buildCompositionThumbnailUrl({
    previewUrl,
    seekTime,
    duration,
    selector,
    selectorIndex,
    origin: window.location.origin,
    contentRevision,
  });
  const request = useMemo(
    () => compositionThumbnailRequest(url, projectId, { sessionEpoch, priority, rich: true }),
    [priority, projectId, sessionEpoch, url],
  );
  const snapshot = useThumbnailLease(request);
  const value =
    snapshot.status === "ready" && snapshot.value.kind === "image" ? snapshot.value : null;
  const { frameW, frameCount } = computeThumbnailStrip(
    container.width,
    value?.aspect ?? 16 / 9,
    container.height,
    48,
  );
  const plan = useMemo(
    () =>
      sourceRangeDuration > 0 && frameCount > 1 && container.width > 0
        ? planCompositionStrip(
            sourceStart,
            sourceRangeDuration,
            (sourceRangeDuration * frameW) / container.width,
          )
        : null,
    [container.width, frameCount, frameW, sourceRangeDuration, sourceStart],
  );

  return (
    <div ref={setContainerRef} className="absolute inset-0 overflow-hidden">
      {value && (
        <ThumbnailTiles
          strip={container}
          frameW={frameW}
          frameCount={frameCount}
          watchGap={watchGap}
          style={{
            animation: "hf-thumb-fade 200ms ease-out",
            mixBlendMode:
              "var(--timeline-composition-thumbnail-blend)" as CSSProperties["mixBlendMode"],
          }}
        >
          {(index) => {
            const tile = plan?.tile(index);
            return (
              <div
                key={index}
                className="relative h-full shrink-0 overflow-hidden"
                style={{ width: frameW }}
              >
                <CompositionTile
                  posterUrl={value.url}
                  stripUrl={tile ? buildCompositionStripUrl(url, plan!.times(tile.chunk)) : null}
                  frame={tile?.frame ?? 0}
                  frames={tile?.frames ?? 1}
                  projectId={projectId}
                  sessionEpoch={sessionEpoch}
                  priority={priority}
                />
              </div>
            );
          }}
        </ThumbnailTiles>
      )}
      {snapshot.status === "loading" && (
        <div className="absolute inset-0 animate-pulse bg-text-0/[0.035]" />
      )}
      {label && (
        <div className="absolute inset-y-0 left-3 z-10 flex items-center">
          <span
            className="block max-w-full truncate text-[10px] font-semibold leading-none"
            style={{
              color: labelColor,
              textShadow: value ? "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)" : "none",
            }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
});
