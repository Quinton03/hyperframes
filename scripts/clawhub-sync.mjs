#!/usr/bin/env node
// `clawhub sync` bumps from the registry's `latest` tag, so a version the registry has hidden
// blocks the skill for good; such a skill is published at the next free patch, then checked live.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TAKEN_VERSION = /Version (\d+)\.(\d+)\.(\d+) already exists/;
const MAX_PATCH_BUMPS = 10;
const OWNER = ["--owner", "heygen-com"];

function takenVersion(message) {
  const match = TAKEN_VERSION.exec(message);
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Publishes at the first patch after `taken` the registry accepts; any other refusal is thrown. */
export function publishAtNextFreeVersion([major, minor, patch], publish) {
  for (let bump = 1; bump <= MAX_PATCH_BUMPS; bump++) {
    const version = `${major}.${minor}.${patch + bump}`;
    const result = publish(version);
    if (result.ok) return version;
    if (!takenVersion(result.message)) throw new Error(result.message);
  }
  throw new Error(
    `No free version within ${MAX_PATCH_BUMPS} patches of ${major}.${minor}.${patch}`,
  );
}

function parsedOutput(result) {
  try {
    return JSON.parse(result.output);
  } catch {
    return null;
  }
}

function latestTag(run, slug) {
  return parsedOutput(run(["inspect", slug, "--json"]))?.skill?.tags?.latest;
}

function failedSkills(sync) {
  return parsedOutput(sync)?.failed ?? [];
}

const syncArgs = (provenance, dryRun) =>
  ["sync", "--all", "--json", "--bump", "patch", ...OWNER, ...provenance].concat(
    dryRun ? ["--dry-run"] : [],
  );

function republishTaken(run, provenance, { slug, message }) {
  const taken = takenVersion(message);
  if (!taken) return `${slug}: ${message}`;
  const folder = `skills/${slug}`;
  const publishAt = (version) =>
    run(
      ["publish", folder, "--slug", slug, "--version", version, "--source-path", folder].concat(
        OWNER,
        provenance,
      ),
    );
  try {
    const version = publishAtNextFreeVersion(taken, publishAt);
    const latest = latestTag(run, slug);
    if (latest !== version)
      return `${slug}: published ${version}, but the registry's latest is ${latest}`;
    console.log(`${slug}: ${taken.join(".")} is taken, published ${version}`);
    return null;
  } catch (error) {
    return `${slug}: ${error.message}`;
  }
}

export function syncSkills({ run, provenance, dryRun }) {
  const sync = run(syncArgs(provenance, dryRun));
  if (sync.ok) return [];
  const failed = dryRun ? [] : failedSkills(sync);
  if (failed.length === 0) return [sync.message];
  return failed.map((skill) => republishTaken(run, provenance, skill)).filter(Boolean);
}

function runClawhub(args) {
  const result = spawnSync("clawhub", args, { encoding: "utf8" });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return { ok: result.status === 0, output: result.stdout, message: result.stdout + result.stderr };
}

function main() {
  const env = process.env;
  const errors = syncSkills({
    run: runClawhub,
    dryRun: env.DRY_RUN === "true",
    provenance: [
      "--changelog",
      `Synced from ${env.GITHUB_SHA.slice(0, 7)} (${env.GITHUB_REF_NAME})`,
      "--source-repo",
      env.GITHUB_REPOSITORY,
      "--source-commit",
      env.GITHUB_SHA,
      "--source-ref",
      env.GITHUB_REF,
    ],
  });
  for (const error of errors) console.error(`::error::${error}`);
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
