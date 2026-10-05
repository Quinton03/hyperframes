import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { resolveProject } from "../utils/project.js";
import {
  appToolsRequest,
  imagesToFiles,
  initializeParams,
  readAppTools,
  type AppToolsEndpoint,
} from "../utils/appTools.js";

export const examples: Example[] = [
  ["What the desktop app offers this turn", "hyperframes app-tools list"],
  [
    "Remove a picture's background",
    `hyperframes app-tools call image.removeBackground '{"asset":"assets/photo.png"}'`,
  ],
];

const NOT_LINKED =
  "No desktop app tools for this project: they are there only while the HyperFrames desktop app's chat sends a request to this session.";

function endpointFor(dir: string | undefined): AppToolsEndpoint | null {
  const project = resolveProject(dir);
  const endpoint = project && readAppTools(project.dir);
  if (!endpoint) {
    console.error(NOT_LINKED);
    setCommandExitCode(1);
  }
  return endpoint;
}

async function answer(work: () => Promise<unknown>): Promise<void> {
  try {
    console.log(JSON.stringify(await work(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    setCommandExitCode(1);
  }
}

const dir = { type: "string", description: "Project directory (default: current)" } as const;

const list = defineCommand({
  meta: { name: "list", description: "The app's instructions and the tools it offers now" },
  args: { dir },
  async run({ args }) {
    const endpoint = endpointFor(args.dir);
    if (!endpoint) return;
    await answer(async () => {
      const { instructions } = await appToolsRequest(endpoint, "initialize", initializeParams);
      const { tools } = await appToolsRequest(endpoint, "tools/list");
      return { instructions, tools };
    });
  },
});

const call = defineCommand({
  meta: { name: "call", description: "Call one of the app's tools with JSON arguments" },
  args: {
    tool: { type: "positional", description: "Tool name, e.g. image.cutOut", required: true },
    input: { type: "positional", description: "JSON arguments (default: {})", required: false },
    dir,
  },
  async run({ args }) {
    const endpoint = endpointFor(args.dir);
    if (!endpoint) return;
    await answer(async () => {
      const input: unknown = JSON.parse(args.input || "{}");
      return imagesToFiles(
        await appToolsRequest(endpoint, "tools/call", { name: args.tool, arguments: input }),
      );
    });
  },
});

export default defineCommand({
  meta: {
    name: "app-tools",
    description: "Use the HyperFrames desktop app's picture and window tools from a linked session",
  },
  subCommands: { list, call },
});
