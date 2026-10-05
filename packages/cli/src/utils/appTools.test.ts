import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { APP_TOOLS_FILE, appToolsRequest, imagesToFiles, readAppTools } from "./appTools.js";

const ENDPOINT = { url: "http://127.0.0.1:4000/mcp/image/chat-1", token: "t0k" };

describe("app tools", () => {
  it("reads where the app's tools answer for a linked project", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-app-tools-"));
    expect(readAppTools(dir)).toBeNull();
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(join(dir, APP_TOOLS_FILE), JSON.stringify(ENDPOINT));
    expect(readAppTools(dir)).toEqual(ENDPOINT);
  });

  it("posts one JSON-RPC request with the app's token and returns its result", async () => {
    const request = vi.fn(async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
    );
    expect(await appToolsRequest(ENDPOINT, "tools/list", {}, request)).toEqual({ tools: [] });
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT.url);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t0k");
    expect(JSON.parse(init.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
  });

  it("says plainly when the app is not working on the project", async () => {
    const gone = async () => new Response(null, { status: 404 });
    await expect(appToolsRequest(ENDPOINT, "tools/list", {}, gone)).rejects.toThrow(
      /not working on this project/,
    );
    const refused = async () =>
      Response.json({ jsonrpc: "2.0", id: 1, error: { message: "No turn is working" } });
    await expect(appToolsRequest(ENDPOINT, "tools/call", {}, refused)).rejects.toThrow(
      "No turn is working",
    );
  });

  it("writes a tool's pictures to files instead of printing base64", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-app-tools-out-"));
    const png = Buffer.from("not really a png").toString("base64");
    const out = imagesToFiles(
      {
        content: [
          { type: "image", data: png, mimeType: "image/png" },
          { type: "text", text: "area 0.2" },
        ],
      },
      () => dir,
    );
    expect(out.content).toEqual([
      { type: "image", path: join(dir, "image-0.png") },
      { type: "text", text: "area 0.2" },
    ]);
    expect(readFileSync(join(dir, "image-0.png"), "utf8")).toBe("not really a png");
  });
});
