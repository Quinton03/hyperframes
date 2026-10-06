// Modified by Quinton03 (muse-ask-agent branch): new file. Not part of upstream HyperFrames.
//
// "Ask agent" hand-off. Upstream Studio only copies the agent prompt to the
// clipboard. When HYPERFRAMES_AGENT_URL is set, this route also POSTs the
// request (instruction, project, selected element, full prompt) to that URL,
// server-side, so the bearer token in HYPERFRAMES_AGENT_TOKEN never reaches
// the browser. Unset = 404 and Studio keeps its clipboard-only behavior.
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

const MAX_TEXT = 64 * 1024;
const TIMEOUT_MS = 15_000;

export interface AgentHandoffConfig {
  url: string;
  token: string;
  label: string;
}

export function agentHandoffConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentHandoffConfig | null {
  const url = (env.HYPERFRAMES_AGENT_URL || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    token: (env.HYPERFRAMES_AGENT_TOKEN || "").trim(),
    label: (env.HYPERFRAMES_AGENT_LABEL || "").trim().slice(0, 40) || "agent",
  };
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// A cross-site page can POST to a loopback port. Refuse any request whose
// Origin is not this Studio's own host.
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function registerAgentRoutes(
  api: Hono,
  adapter: StudioApiAdapter,
  getConfig: () => AgentHandoffConfig | null = () => agentHandoffConfig(),
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): void {
  api.get("/agent", (c) => {
    const config = getConfig();
    return c.json({ enabled: Boolean(config), label: config?.label ?? null });
  });

  api.post("/projects/:id/agent", async (c) => {
    const config = getConfig();
    if (!config) return c.json({ error: "no agent configured" }, 404);
    if (!sameOrigin(c.req.header("origin"), c.req.header("host"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!(c.req.header("content-type") || "").includes("application/json")) {
      return c.json({ error: "json body required" }, 415);
    }
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: Record<string, unknown>;
    try {
      const parsed = (await c.req.json()) as unknown;
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const instruction = text(body.instruction, 4000).trim();
    if (!instruction) return c.json({ error: "instruction is required" }, 400);
    const sel = (
      body.selection && typeof body.selection === "object" ? body.selection : {}
    ) as Record<string, unknown>;

    const payload = {
      source: "hyperframes-studio",
      instruction,
      prompt: text(body.prompt),
      project: { id: project.id, title: project.title ?? null, dir: project.dir },
      selection: {
        label: text(sel.label, 200),
        tagName: text(sel.tagName, 40),
        id: text(sel.id, 200) || null,
        selector: text(sel.selector, 500) || null,
        sourceFile: text(sel.sourceFile, 500) || null,
        compositionPath: text(sel.compositionPath, 500) || null,
      },
      currentTime:
        typeof body.currentTime === "number" && Number.isFinite(body.currentTime)
          ? body.currentTime
          : null,
      studioUrl: text(body.studioUrl, 1000) || null,
    };

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (config.token) headers.authorization = `Bearer ${config.token}`;
    try {
      const res = await fetchImpl(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const reply = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return c.json(
          { error: `agent answered ${res.status}`, detail: text(reply.error, 300) },
          502,
        );
      }
      return c.json({ ok: true, label: config.label, id: reply.id ?? null });
    } catch (err) {
      return c.json(
        { error: `agent unreachable: ${err instanceof Error ? err.message : String(err)}` },
        502,
      );
    }
  });
}
