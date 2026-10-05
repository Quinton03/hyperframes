import type { Hono } from "hono";
import {
  HANDOFF_READY,
  desktopDownloadUrl,
  desktopInstalled,
  openInDesktop,
} from "../utils/desktopApp.js";
import {
  AGENT_RELAY_PATH,
  postToInbox,
  relayAuthorized,
  type AgentRelay,
} from "../utils/agentLink.js";
import { identityAllowed } from "./telemetryIdentity.js";

const RELAY_MAX_CHARS = 200_000;

/** A bodiless POST is a simple request, so any page can send one to localhost: it has to come from this Studio. */
export function sameOriginPost(headers: {
  host?: string;
  origin?: string;
  fetchSite?: string;
}): boolean {
  const { host, origin, fetchSite } = headers;
  if (!host || !identityAllowed(host)) return false;
  if (fetchSite && fetchSite !== "same-origin") return false;
  return origin === undefined || origin === `http://${host}`;
}

export function relayFor(
  host: string,
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AgentRelay | undefined {
  const inbox = env.CLAUDE_CODE_MESSAGING_SOCKET;
  return token && inbox ? { url: `http://${host}${AGENT_RELAY_PATH}`, token, inbox } : undefined;
}

/** Edit with Framey's route: whether to show it, where to download, and whether the app takes the project. */
export function mountDesktopRoutes(
  app: Hono,
  projectDir: string,
  {
    ready = HANDOFF_READY,
    open = openInDesktop,
    platform = process.platform,
    installed = () => desktopInstalled({ platform }),
    relayToken,
    env = process.env,
    post = postToInbox,
  }: {
    ready?: boolean;
    open?: typeof openInDesktop;
    platform?: NodeJS.Platform;
    installed?: () => boolean;
    relayToken?: string;
    env?: NodeJS.ProcessEnv;
    post?: typeof postToInbox;
  } = {},
): void {
  const downloadUrl = desktopDownloadUrl(platform);
  app.get("/api/open-in-desktop", (c) =>
    c.json({ available: downloadUrl !== null || installed(), handoff: ready, downloadUrl }),
  );
  app.post("/api/open-in-desktop", (c) => {
    const allowed = sameOriginPost({
      host: c.req.header("host"),
      origin: c.req.header("origin"),
      fetchSite: c.req.header("sec-fetch-site"),
    });
    if (!allowed) return c.json({ error: "forbidden" }, 403);
    if (!ready)
      return c.json({
        opened: false,
        reason: "handoff-unavailable",
        downloadUrl,
      });
    const relay = relayFor(c.req.header("host") ?? "", relayToken, env);
    return c.json(open(projectDir, { env, ...(relay && { relay }) }));
  });
  app.post(AGENT_RELAY_PATH, async (c) => {
    const inbox = env.CLAUDE_CODE_MESSAGING_SOCKET;
    if (!relayToken || !inbox || !identityAllowed(c.req.header("host")))
      return c.json({ error: "not-found" }, 404);
    if (!relayAuthorized(c.req.header("authorization"), relayToken))
      return c.json({ error: "forbidden" }, 403);
    const text = relayText(await c.req.json().catch(() => null));
    if (!text) return c.json({ error: "bad-request" }, 400);
    return post(inbox, text, env.CLAUDE_CODE_MESSAGING_TOKEN).then(
      () => c.json({ sent: true }, 202),
      () => c.json({ error: "inbox-unreachable" }, 502),
    );
  });
}

function relayText(body: unknown): string | null {
  const text = typeof body === "object" && body !== null && "text" in body ? body.text : null;
  return typeof text === "string" && text && text.length <= RELAY_MAX_CHARS ? text : null;
}
