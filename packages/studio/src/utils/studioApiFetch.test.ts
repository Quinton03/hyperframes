import { afterEach, describe, expect, it, vi } from "vitest";
import { studioApiFetch } from "./studioApiFetch";

describe("studioApiFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends Studio's requests without credentials, keeping the caller's options", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await studioApiFetch("/api/projects/demo/history/step", { method: "POST", signal });

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/demo/history/step", {
      method: "POST",
      signal,
      credentials: "omit",
    });
  });
});
