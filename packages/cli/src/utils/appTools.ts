import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../version.js";

// The desktop app's own tools (pictures, its window) for a Claude Code session the app's chat is linked to: the app
// writes where they answer, for that turn, to .hyperframes/app-tools.json; the session reaches them through this
// CLI, as tools cannot be added to a session that is already running.
export const APP_TOOLS_FILE = join(".hyperframes", "app-tools.json");

export interface AppToolsEndpoint {
  url: string;
  token: string;
}

export function readAppTools(dir: string): AppToolsEndpoint | null {
  try {
    const found: unknown = JSON.parse(readFileSync(join(dir, APP_TOOLS_FILE), "utf8"));
    if (typeof found !== "object" || found === null) return null;
    const { url, token } = found as Record<string, unknown>;
    return typeof url === "string" && typeof token === "string" ? { url, token } : null;
  } catch {
    return null;
  }
}

/** One JSON-RPC request to the app's MCP route, which answers each POST on its own in JSON (stateless). */
export async function appToolsRequest(
  { url, token }: AppToolsEndpoint,
  method: string,
  params: Record<string, unknown> = {},
  request: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const res = await request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (res.status === 401 || res.status === 404)
    throw new Error("The HyperFrames desktop app is not working on this project right now.");
  if (!res.ok) throw new Error(`The desktop app answered ${res.status}.`);
  const reply = (await res.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  if (reply.error) throw new Error(reply.error.message ?? "The desktop app refused the request.");
  return reply.result ?? {};
}

export const initializeParams = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "hyperframes-cli", version: VERSION },
};

/** A tool's picture as a file to open, not pages of base64 in the session's output. */
export function imagesToFiles(
  result: Record<string, unknown>,
  folder: () => string = () => mkdtempSync(join(tmpdir(), "hf-app-tools-")),
): Record<string, unknown> {
  if (!Array.isArray(result.content)) return result;
  let dir: string | undefined;
  const content = result.content.map((item: unknown, i: number) => {
    const part = item as { type?: unknown; data?: unknown; mimeType?: unknown };
    if (part?.type !== "image" || typeof part.data !== "string") return item;
    dir ??= folder();
    const path = join(dir, `image-${i}.${part.mimeType === "image/jpeg" ? "jpg" : "png"}`);
    writeFileSync(path, Buffer.from(part.data, "base64"));
    return { type: "image", path };
  });
  return { ...result, content };
}
