import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_LINK_FILE,
  postToInbox,
  readAgentLink,
  refreshAgentLinks,
  relayAuthorized,
  writeAgentLink,
} from "./agentLink.js";

const SESSION = {
  CLAUDE_CODE_SESSION_ID: "s-1",
  CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock",
};
const RELAY = {
  url: "http://localhost:3002/api/agent-link/message",
  token: "t",
  inbox: "/tmp/cc-socks/1.sock",
};
const dirs: string[] = [];
const film = () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-link-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("agent link", () => {
  it("records a Claude Code session's inbox, owner-only", () => {
    const dir = film();
    expect(writeAgentLink(dir, { env: SESSION, relay: RELAY })).toEqual({
      engine: "claude",
      sessionId: "s-1",
      inbox: "/tmp/cc-socks/1.sock",
      relay: RELAY,
    });
    expect(readAgentLink(dir)?.relay).toEqual(RELAY);
    if (process.platform !== "win32")
      expect(statSync(join(dir, AGENT_LINK_FILE)).mode & 0o777).toBe(0o600);
  });

  it("writes nothing for Codex or outside an agent", () => {
    const dir = film();
    expect(writeAgentLink(dir, { env: { CODEX_THREAD_ID: "c-1" } })).toBeNull();
    expect(readAgentLink(dir)).toBeNull();
  });

  it("keeps the relay while it forwards to the same inbox, drops it for a resumed session", () => {
    const dir = film();
    writeAgentLink(dir, { env: SESSION, relay: RELAY });
    expect(writeAgentLink(dir, { env: SESSION })?.relay).toEqual(RELAY);
    const resumed = { ...SESSION, CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/2.sock" };
    expect(writeAgentLink(dir, { env: resumed })).toEqual({
      engine: "claude",
      sessionId: "s-1",
      inbox: "/tmp/cc-socks/2.sock",
    });
  });

  it("keeps the app's marks while the link names the same session, drops them for a resumed one", () => {
    const dir = film();
    writeAgentLink(dir, { env: SESSION });
    const file = join(dir, AGENT_LINK_FILE);
    writeFileSync(file, JSON.stringify({ ...readAgentLink(dir), briefed: true }));
    writeAgentLink(dir, { env: SESSION });
    expect(JSON.parse(readFileSync(file, "utf8")).briefed).toBe(true);
    writeAgentLink(dir, {
      env: { ...SESSION, CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/2.sock" },
    });
    expect(JSON.parse(readFileSync(file, "utf8")).briefed).toBeUndefined();
  });

  it("refreshes only projects already linked", () => {
    const linked = film();
    const other = film();
    writeAgentLink(linked, { env: SESSION });
    const resumed = { ...SESSION, CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/2.sock" };
    refreshAgentLinks([linked, other, join(other, "missing")], resumed);
    expect(readAgentLink(linked)?.inbox).toBe("/tmp/cc-socks/2.sock");
    expect(readAgentLink(other)).toBeNull();
  });

  it("reads a damaged link as none", () => {
    const dir = film();
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(join(dir, AGENT_LINK_FILE), "{");
    expect(readAgentLink(dir)).toBeNull();
  });
});

describe("relayAuthorized", () => {
  it("takes only the exact bearer token", () => {
    expect(relayAuthorized("Bearer t", "t")).toBe(true);
    expect(relayAuthorized("Bearer x", "t")).toBe(false);
    expect(relayAuthorized(undefined, "t")).toBe(false);
  });
});

describe.skipIf(process.platform === "win32")("postToInbox", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("writes an auth line, then the message as a user line", async () => {
    const inbox = join(film(), "in.sock");
    const got = new Promise<string>((done) => {
      server = createServer((socket) => {
        let text = "";
        socket.on("data", (chunk) => (text += chunk));
        socket.on("end", () => done(text));
      }).listen(inbox);
    });
    await new Promise((ready) => server?.once("listening", ready));
    await postToInbox(inbox, "make it blue", "own");
    const lines = (await got)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { type: "auth", token: "own" },
      { type: "user", message: { role: "user", content: "make it blue" } },
    ]);
  });

  it("fails when nothing listens", async () => {
    await expect(postToInbox(join(film(), "gone.sock"), "hi")).rejects.toThrow();
  });
});
