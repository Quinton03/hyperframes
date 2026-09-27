// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./useFileTree", () => ({
  useFileTree: () => ({
    projectDir: "",
    fileTree: [],
    fileTreeLoaded: true,
    refreshFileTree: vi.fn(async () => {}),
    compositions: [],
    assets: [],
    fontAssets: [],
  }),
}));

vi.mock("./useEditorSave", () => ({
  useEditorSave: () => ({
    saveRafRef: { current: null },
    handleContentChange: vi.fn(),
    getPendingCandidate: vi.fn(() => null),
    flushPendingSave: vi.fn(async () => ({ status: "clean" as const })),
    discardPendingSave: vi.fn(),
  }),
}));

import { useFileManager } from "./useFileManager";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function uploadClip(response: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { ok: true, files: [], skipped: [], invalid: [], ...response },
        { status: 201 },
      ),
    ),
  );
  const showToast = vi.fn();
  const captured: { manager: ReturnType<typeof useFileManager> | null } = { manager: null };
  function Probe() {
    captured.manager = useFileManager({
      projectId: "project-a",
      showToast,
      recordEdit: vi.fn(async () => {}),
      setRefreshKey: vi.fn(),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  const added = await act(() =>
    captured.manager!.uploadProjectFiles([new File(["x"], "clip.mp4")]),
  );
  act(() => root.unmount());
  return { added, showToast };
}

it("says which uploads were added without a media check, and why", async () => {
  const reason =
    "not checked: ffprobe was not found. Install FFmpeg or set HYPERFRAMES_FFPROBE_PATH.";
  const { added, showToast } = await uploadClip({
    files: ["clip.mp4"],
    unchecked: [{ name: "clip.mp4", reason }],
  });

  expect(added).toEqual(["clip.mp4"]);
  expect(showToast).toHaveBeenCalledWith(`Added clip.mp4, ${reason}`, "info");
});

it("says why an upload was not added", async () => {
  const reason = 'HYPERFRAMES_FFPROBE_PATH names "/x/ffprobe", which cannot run: fix it or unset it';
  const { added, showToast } = await uploadClip({ invalid: [{ name: "clip.mp4", reason }] });

  expect(added).toEqual([]);
  expect(showToast).toHaveBeenCalledWith(`Not added: clip.mp4, ${reason}`);
});
