// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountReactHarness } from "./domSelectionTestHarness";
import { useBlockHandlers, type UseBlockHandlersResult } from "./useBlockHandlers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../utils/blockInstaller", () => ({
  addBlockToProject: async (opts: { showToast: (message: string) => void }) => {
    opts.showToast("Installing catalog items needs hyperframes preview");
    return null;
  },
}));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useBlockHandlers", () => {
  it("leaves only the error toast when an install fails", async () => {
    const shown: string[] = [];
    const showToast = vi.fn((message: string) => {
      shown.push(message);
      return shown.length;
    });
    const dismissToast = vi.fn();
    let handlers: UseBlockHandlersResult | undefined;
    function Harness() {
      handlers = useBlockHandlers({
        projectId: "demo",
        blockCtxDeps: {
          activeCompPath: null,
          timelineElements: [],
          readProjectFile: async () => "",
          writeProjectFile: async () => {},
          recordEdit: async () => {},
          refreshFileTree: async () => {},
          reloadPreview: () => {},
          showToast,
          dismissToast,
        },
        previewIframeRef: { current: null },
        setRightCollapsed: () => {},
        setRightPanelTab: () => {},
      });
      return null;
    }
    mountReactHarness(<Harness />);

    await act(async () => {
      handlers!.handleAddBlock("x-post");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(shown).toEqual(["Adding x-post…", "Installing catalog items needs hyperframes preview"]);
    expect(dismissToast).toHaveBeenCalledWith(1);
  });
});
