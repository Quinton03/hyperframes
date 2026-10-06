// Modified by Quinton03 (muse-ask-agent branch): new file. Tests for routes/agent.ts.
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  agentHandoffConfig,
  registerAgentRoutes,
  sameOrigin,
  type AgentHandoffConfig,
} from "./agent";
import type { StudioApiAdapter } from "../types";

function createAdapter(): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) =>
      id === "demo" ? { id, dir: "/tmp/demo", title: "Demo" } : null,
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
  };
}

const CONFIG: AgentHandoffConfig = { url: "http://agent.test/hook", token: "tok", label: "Muse" };

function app(config: AgentHandoffConfig | null, fetchImpl?: typeof fetch) {
  const api = new Hono();
  registerAgentRoutes(api, createAdapter(), () => config, fetchImpl);
  return api;
}

function post(api: Hono, body: unknown, headers: Record<string, string> = {}) {
  return api.request("/projects/demo/agent", {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1:5190", ...headers },
    body: JSON.stringify(body),
  });
}

describe("agent hand-off routes", () => {
  it("reads config from env and rejects non-http urls", () => {
    expect(agentHandoffConfig({})).toBeNull();
    expect(agentHandoffConfig({ HYPERFRAMES_AGENT_URL: "file:///x" })).toBeNull();
    expect(
      agentHandoffConfig({ HYPERFRAMES_AGENT_URL: "https://a/b", HYPERFRAMES_AGENT_LABEL: "Muse" }),
    ).toEqual({
      url: "https://a/b",
      token: "",
      label: "Muse",
    });
  });

  it("reports disabled and answers 404 when no agent is configured", async () => {
    const api = app(null);
    expect(await (await api.request("/agent")).json()).toEqual({ enabled: false, label: null });
    expect((await post(api, { instruction: "x" })).status).toBe(404);
  });

  it("forwards the request with the bearer token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 42 }), { status: 200 }));
    const api = app(CONFIG, fetchImpl as unknown as typeof fetch);
    expect(await (await api.request("/agent")).json()).toEqual({ enabled: true, label: "Muse" });
    const res = await post(api, {
      instruction: "make it bigger",
      prompt: "full prompt",
      selection: { label: "Title", tagName: "h1", selector: ".title", sourceFile: "index.html" },
      currentTime: 2.5,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, label: "Muse", id: 42 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CONFIG.url);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const sent = JSON.parse(String(init.body));
    expect(sent.instruction).toBe("make it bigger");
    expect(sent.project).toEqual({ id: "demo", title: "Demo", dir: "/tmp/demo" });
    expect(sent.selection.selector).toBe(".title");
    expect(sent.currentTime).toBe(2.5);
  });

  it("refuses cross-origin posts, empty instructions and unknown projects", async () => {
    const fetchImpl = vi.fn();
    const api = app(CONFIG, fetchImpl as unknown as typeof fetch);
    // fetch's Request drops Origin/Host, so the guard itself is checked directly.
    expect(sameOrigin("https://evil.example", "127.0.0.1:5190")).toBe(false);
    expect(sameOrigin("http://127.0.0.1:5190", "127.0.0.1:5190")).toBe(true);
    expect(sameOrigin(undefined, "127.0.0.1:5190")).toBe(true);
    expect((await post(api, { instruction: "  " })).status).toBe(400);
    const missing = await api.request("/projects/nope/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "x" }),
    });
    expect(missing.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 502 when the agent fails", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "nope" }), { status: 401 }),
    );
    const res = await post(app(CONFIG, fetchImpl as unknown as typeof fetch), { instruction: "x" });
    expect(res.status).toBe(502);
  });
});
