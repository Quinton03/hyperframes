import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWithEnv(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./studioApiFetch");
}

describe("studioApiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends Studio's requests without credentials, keeping the caller's options", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { studioApiFetch } = await loadWithEnv({});
    const signal = new AbortController().signal;

    await studioApiFetch("/api/projects/demo/history/step", { method: "POST", signal });

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/demo/history/step", {
      method: "POST",
      signal,
      credentials: "omit",
    });
  });

  it("sends same-origin credentials for a host that opted out", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const { studioApiFetch } = await loadWithEnv({
      VITE_STUDIO_API_SAME_ORIGIN_CREDENTIALS: "true",
    });

    await studioApiFetch("/api/projects/demo/files/index.html");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/demo/files/index.html", {
      credentials: "same-origin",
    });
  });
});
