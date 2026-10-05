import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";

// The live link the desktop app follows to the Claude Code session that made a project: that session's inbox socket
// (Claude Code's cross-session messaging), and a preview relaying for it. Unlike the hand-off, the app keeps reading
// it, so the agent session stays the one that does the work.
export const AGENT_LINK_FILE = join(".hyperframes", "agent-link.json");
export const AGENT_RELAY_PATH = "/api/agent-link/message";

/** A preview that forwards to `inbox`. Started by the session itself, Claude Code takes it for its own child and
 * delivers even when the session skips permission prompts; the app reaching the inbox directly is held then. */
export interface AgentRelay {
  url: string;
  token: string;
  inbox: string;
}

export interface AgentLink {
  engine: "claude";
  sessionId: string;
  inbox: string;
  relay?: AgentRelay;
}

/** Only Claude Code has an inbox; a Codex session keeps the one-time hand-off. */
function linkFromEnv(env: NodeJS.ProcessEnv = process.env): AgentLink | null {
  const { CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_CODE_MESSAGING_SOCKET: inbox } = env;
  return sessionId && inbox ? { engine: "claude", sessionId, inbox } : null;
}

function isRelay(value: unknown): value is AgentRelay {
  if (typeof value !== "object" || value === null) return false;
  const relay = value as Record<string, unknown>;
  return (
    typeof relay.url === "string" &&
    typeof relay.token === "string" &&
    typeof relay.inbox === "string"
  );
}

export function readAgentLink(dir: string): AgentLink | null {
  try {
    const link: unknown = JSON.parse(readFileSync(join(dir, AGENT_LINK_FILE), "utf8"));
    if (typeof link !== "object" || link === null) return null;
    const { engine, sessionId, inbox, relay } = link as Record<string, unknown>;
    if (engine !== "claude" || typeof sessionId !== "string" || typeof inbox !== "string")
      return null;
    return { engine, sessionId, inbox, ...(isRelay(relay) && { relay }) };
  } catch {
    return null;
  }
}

/** Points the project at this session; a relay is kept only while it forwards to the same inbox. Owner-only, as
 * the relay token in it lets any process post to the session. */
export function writeAgentLink(
  dir: string,
  { env = process.env, relay }: { env?: NodeJS.ProcessEnv; relay?: AgentRelay } = {},
): AgentLink | null {
  const session = linkFromEnv(env);
  if (!session) return null;
  const kept = relay ?? readAgentLink(dir)?.relay;
  const link: AgentLink = { ...session, ...(kept?.inbox === session.inbox && { relay: kept }) };
  const file = join(dir, AGENT_LINK_FILE);
  try {
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    const draft = `${file}.${process.pid}.tmp`;
    writeFileSync(draft, JSON.stringify(link), { mode: 0o600 });
    renameSync(draft, file);
    return link;
  } catch {
    return null;
  }
}

/** A resumed session has a new inbox: any command run in a linked project points the app at it again. */
export function refreshAgentLinks(dirs: string[], env: NodeJS.ProcessEnv = process.env): void {
  if (!linkFromEnv(env)) return;
  for (const dir of new Set(dirs.map((d) => resolve(d))))
    if (existsSync(join(dir, AGENT_LINK_FILE))) writeAgentLink(dir, { env });
}

export const newRelayToken = (): string => randomUUID();

export function relayAuthorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** One message into a Claude Code inbox, the way its own help shows a script posting: an auth line, then a user
 * line. The inbox answers nothing; resolves once the socket closed after the write. */
export function postToInbox(
  inbox: string,
  text: string,
  token?: string,
  timeoutMs = 5_000,
): Promise<void> {
  return new Promise((done, fail) => {
    const socket = createConnection(inbox);
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("inbox did not take the message")));
    socket.once("error", fail);
    socket.once("connect", () => {
      const lines = [
        ...(token ? [{ type: "auth", token }] : []),
        { type: "user", message: { role: "user", content: text } },
      ];
      socket.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    });
    socket.once("close", (hadError) => {
      if (!hadError) done();
    });
  });
}
