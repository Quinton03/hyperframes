import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncSkills } from "./clawhub-sync.mjs";

const TAKEN = (version) =>
  `Version ${version} already exists. Increment the version number and try again. (reset in 24s)`;

function fakeClawhub({
  syncFailed,
  syncOutput,
  takenVersions = [],
  refuse = null,
  hidden = false,
}) {
  const calls = [];
  let published = "1.0.12";
  const publish = (args) => {
    const version = args[args.indexOf("--version") + 1];
    if (refuse) return { ok: false, output: "", message: refuse };
    if (takenVersions.includes(version)) return { ok: false, output: "", message: TAKEN(version) };
    if (!hidden) published = version;
    return { ok: true, output: "{}", message: "" };
  };
  const syncResult = () => {
    const output = syncOutput ?? JSON.stringify({ ok: false, published: [], failed: syncFailed });
    return { ok: false, output, message: output };
  };
  const inspect = () => ({
    ok: true,
    output: JSON.stringify({ skill: { tags: { latest: published } } }),
  });
  const commands = { sync: syncResult, inspect, publish };
  const run = (args) => {
    calls.push(args);
    return commands[args[0]](args);
  };
  return { run, calls };
}

const provenance = ["--changelog", "Synced from 6c353d8 (main)", "--source-commit", "6c353d8"];
const sync = (clawhub, dryRun = false) => syncSkills({ run: clawhub.run, provenance, dryRun });
const SYNC_ARGS = ["sync", "--all", "--json", "--bump", "patch", "--owner", "heygen-com"];
const creativeTaken = { slug: "hyperframes-creative", message: TAKEN("1.0.13") };

describe("ClawHub skill sync", () => {
  it("publishes a skill whose bumped version is taken one patch past it, then reads it back", () => {
    const clawhub = fakeClawhub({ syncFailed: [creativeTaken] });

    assert.deepEqual(sync(clawhub), []);
    assert.deepEqual(clawhub.calls, [
      [...SYNC_ARGS, ...provenance],
      [
        "publish",
        "skills/hyperframes-creative",
        "--slug",
        "hyperframes-creative",
        "--version",
        "1.0.14",
        "--source-path",
        "skills/hyperframes-creative",
        "--owner",
        "heygen-com",
        ...provenance,
      ],
      ["inspect", "heygen-com/hyperframes-creative", "--json"],
    ]);
  });

  it("fails when the registry does not show the version it accepted", () => {
    const clawhub = fakeClawhub({ syncFailed: [creativeTaken], hidden: true });

    assert.deepEqual(sync(clawhub), [
      "hyperframes-creative: published 1.0.14, but the registry's latest is 1.0.12",
    ]);
  });

  it("fails rather than skipping further when the next patch is taken too", () => {
    const clawhub = fakeClawhub({ syncFailed: [creativeTaken], takenVersions: ["1.0.14"] });

    assert.deepEqual(sync(clawhub), [`hyperframes-creative: ${TAKEN("1.0.14")}`]);
    assert.equal(clawhub.calls.filter((args) => args[0] === "publish").length, 1);
  });

  it("still fails on any other refusal, without retrying it", () => {
    const clawhub = fakeClawhub({ syncFailed: [{ slug: "figma", message: "Unauthorized" }] });

    assert.deepEqual(sync(clawhub), ["figma: Unauthorized"]);
    assert.equal(clawhub.calls.filter((args) => args[0] === "publish").length, 0);
  });

  it("reports a republish the registry refuses for another reason", () => {
    const clawhub = fakeClawhub({
      syncFailed: [{ slug: "figma", message: TAKEN("1.0.17") }],
      refuse: "Rate limited",
    });

    assert.deepEqual(sync(clawhub), ["figma: Rate limited"]);
  });

  it("fails a sync that reports no failed skill or no readable result", () => {
    assert.deepEqual(sync(fakeClawhub({ syncFailed: [] })), [
      JSON.stringify({ ok: false, published: [], failed: [] }),
    ]);
    assert.deepEqual(sync(fakeClawhub({ syncOutput: "Error: not logged in" })), [
      "Error: not logged in",
    ]);
  });

  it("only previews in a dry run, even when a version is taken", () => {
    const clawhub = fakeClawhub({ syncFailed: [creativeTaken] });

    assert.equal(sync(clawhub, true).length, 1);
    assert.deepEqual(clawhub.calls, [[...SYNC_ARGS, ...provenance, "--dry-run"]]);
  });
});
