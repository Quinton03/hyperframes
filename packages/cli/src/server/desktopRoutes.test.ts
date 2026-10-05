import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { desktopDownloadUrl, type DesktopOpenResult } from "../utils/desktopApp.js";
import { mountDesktopRoutes, sameOriginPost } from "./desktopRoutes.js";

const STUDIO = {
  host: "localhost:3002",
  origin: "http://localhost:3002",
  "sec-fetch-site": "same-origin",
};
const OPENED: DesktopOpenResult = {
  opened: true,
  app: "the HyperFrames desktop app",
  handedOver: null,
  link: null,
};

function server(
  ready: boolean,
  place: {
    platform?: NodeJS.Platform;
    installed?: () => boolean;
    relayToken?: string;
    env?: NodeJS.ProcessEnv;
    post?: (inbox: string, text: string, token?: string) => Promise<void>;
  } = {},
) {
  const app = new Hono();
  const open = vi.fn((_dir: string, _options?: unknown): DesktopOpenResult => OPENED);
  mountDesktopRoutes(app, "/films/a", { ready, open, env: {}, ...place });
  const post = (headers: Record<string, string>) =>
    app.request("/api/open-in-desktop", { method: "POST", headers });
  return { app, open, post };
}

describe("open-in-desktop routes", () => {
  it("tells Studio whether to show the button and whether the app can take the project", async () => {
    const body = await (
      await server(false, { installed: () => false }).app.request("/api/open-in-desktop")
    ).json();
    const downloadUrl = desktopDownloadUrl();
    expect(body).toEqual({ available: downloadUrl !== null, handoff: false, downloadUrl });
  });

  it("shows the button where the app is installed even without a download (Windows)", async () => {
    const get = async (installed: boolean) =>
      (
        await server(true, { platform: "win32", installed: () => installed }).app.request(
          "/api/open-in-desktop",
        )
      ).json();
    expect(await get(true)).toEqual({ available: true, handoff: true, downloadUrl: null });
    expect(await get(false)).toMatchObject({ available: false });
  });

  it("refuses a POST from another site, or through a rebound host name", async () => {
    const { open, post } = server(true);
    const crossSite = { ...STUDIO, origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    expect((await post(crossSite)).status).toBe(403);
    expect(
      (await post({ ...STUDIO, host: "evil.example:3002", origin: "http://evil.example:3002" }))
        .status,
    ).toBe(403);
    expect(open).not.toHaveBeenCalled();
  });

  it("while gated, answers Studio's own POST with the download and opens nothing", async () => {
    const { open, post } = server(false);
    const res = await post(STUDIO);
    expect(await res.json()).toMatchObject({ opened: false, reason: "handoff-unavailable" });
    expect(open).not.toHaveBeenCalled();
  });

  it("once live, opens this server's project for Studio's own POST", async () => {
    const { open, post } = server(true);
    expect(await (await post(STUDIO)).json()).toEqual(OPENED);
    expect(open).toHaveBeenCalledWith("/films/a", { env: {} });
  });

  it("inside a Claude Code session, hands the app this preview as the session's relay", async () => {
    const env = { CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock" };
    const { open, post } = server(true, { relayToken: "t0k", env });
    await post(STUDIO);
    expect(open).toHaveBeenCalledWith("/films/a", {
      env,
      relay: {
        url: "http://localhost:3002/api/agent-link/message",
        token: "t0k",
        inbox: "/tmp/cc-socks/1.sock",
      },
    });
  });
});

describe("agent relay", () => {
  const ENV = {
    CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock",
    CLAUDE_CODE_MESSAGING_TOKEN: "own",
  };
  const send = (
    app: Hono,
    {
      auth = "Bearer t0k",
      host = "127.0.0.1:3002",
      body = { text: "make it blue" } as unknown,
    } = {},
  ) =>
    app.request("/api/agent-link/message", {
      method: "POST",
      headers: { host, authorization: auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("forwards the app's message to the session that started this preview", async () => {
    const post = vi.fn(async () => {});
    const { app } = server(true, { relayToken: "t0k", env: ENV, post });
    const res = await send(app);
    expect(res.status).toBe(202);
    expect(post).toHaveBeenCalledWith("/tmp/cc-socks/1.sock", "make it blue", "own");
  });

  it("refuses without the token, through a rebound host, or with no text", async () => {
    const post = vi.fn(async () => {});
    const { app } = server(true, { relayToken: "t0k", env: ENV, post });
    expect((await send(app, { auth: "Bearer nope" })).status).toBe(403);
    expect((await send(app, { host: "evil.example:3002" })).status).toBe(404);
    expect((await send(app, { body: { text: "" } })).status).toBe(400);
    expect(post).not.toHaveBeenCalled();
  });

  it("is not there outside a Claude Code session", async () => {
    const { app } = server(true, { relayToken: "t0k", env: {} });
    expect((await send(app)).status).toBe(404);
  });

  it("says when the session's inbox is gone", async () => {
    const post = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const { app } = server(true, { relayToken: "t0k", env: ENV, post });
    expect((await send(app)).status).toBe(502);
  });
});

describe("sameOriginPost", () => {
  it("lets a local process without browser headers through, never a foreign origin", () => {
    expect(sameOriginPost({ host: "127.0.0.1:3002" })).toBe(true);
    expect(sameOriginPost({ host: "localhost:3002", origin: "http://localhost:3003" })).toBe(false);
    expect(sameOriginPost({ host: "localhost:3002", fetchSite: "same-site" })).toBe(false);
    expect(sameOriginPost({})).toBe(false);
  });
});
