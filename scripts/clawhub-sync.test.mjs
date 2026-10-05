import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { publishAtNextFreeVersion, syncSkills, takenVersion } from "./clawhub-sync.mjs";

const TAKEN = (version) =>
  `Version ${version} already exists. Increment the version number and try again. (reset in 24s)`;

function fakeClawhub({ syncFailed, takenVersions = [], refuse = null }) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "sync") {
      const output = JSON.stringify({ ok: false, published: [], failed: syncFailed });
      return { ok: syncFailed.length === 0, output, message: output };
    }
    const version = args[args.indexOf("--version") + 1];
    if (refuse) return { ok: false, output: "", message: refuse };
    if (takenVersions.includes(version)) return { ok: false, output: "", message: TAKEN(version) };
    return { ok: true, output: "{}", message: "" };
  };
  return { run, calls };
}

const provenance = ["--changelog", "Synced from 6c353d8 (main)"];

describe("ClawHub skill sync", () => {
  it("publishes a skill whose bumped version is taken at the next free patch", () => {
    const { run, calls } = fakeClawhub({
      syncFailed: [{ slug: "hyperframes-creative", message: TAKEN("1.0.13") }],
      takenVersions: ["1.0.14"],
    });

    assert.deepEqual(syncSkills({ run, provenance, dryRun: false }), []);
    const publishes = calls.filter((args) => args[0] === "publish");
    assert.deepEqual(
      publishes.map((args) => args[args.indexOf("--version") + 1]),
      ["1.0.14", "1.0.15"],
    );
    assert.deepEqual(publishes[1].slice(0, 4), [
      "publish",
      "skills/hyperframes-creative",
      "--slug",
      "hyperframes-creative",
    ]);
    assert.ok(publishes[1].includes("Synced from 6c353d8 (main)"));
  });

  it("still fails on any other refusal, without retrying it", () => {
    const { run, calls } = fakeClawhub({
      syncFailed: [{ slug: "figma", message: "Unauthorized" }],
    });

    assert.deepEqual(syncSkills({ run, provenance, dryRun: false }), ["figma: Unauthorized"]);
    assert.equal(calls.filter((args) => args[0] === "publish").length, 0);
  });

  it("reports a republish the registry refuses for another reason", () => {
    const { run } = fakeClawhub({
      syncFailed: [{ slug: "figma", message: TAKEN("1.0.17") }],
      refuse: "Rate limited",
    });

    assert.deepEqual(syncSkills({ run, provenance, dryRun: false }), ["figma: Rate limited"]);
  });

  it("gives up after a bounded number of taken versions", () => {
    assert.throws(
      () =>
        publishAtNextFreeVersion([1, 0, 13], (version) => ({ ok: false, message: TAKEN(version) })),
      /No free version within 10 patches of 1\.0\.13/,
    );
  });

  it("reads the taken version from the registry's refusal", () => {
    assert.deepEqual(takenVersion(TAKEN("1.0.13")), [1, 0, 13]);
    assert.equal(takenVersion("Unauthorized"), null);
  });
});
