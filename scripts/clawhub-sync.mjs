#!/usr/bin/env node
// `clawhub sync` bumps from the registry's `latest` tag, which skips versions the registry holds
// unpublished; a skill whose next version is taken that way is published at the next free patch.
import { spawnSync } from "node:child_process";

const TAKEN_VERSION = /Version (\d+)\.(\d+)\.(\d+) already exists/;
const MAX_PATCH_BUMPS = 10;

export function takenVersion(message) {
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

function failedSkills(output) {
  try {
    return JSON.parse(output).failed ?? null;
  } catch {
    return null;
  }
}

/** Runs the sync, then republishes each skill it failed only because its version was taken. */
export function syncSkills({ run, provenance, dryRun }) {
  const owner = ["--owner", "heygen-com"];
  const sync = run(
    ["sync", "--all", "--json", "--bump", "patch", ...owner, ...provenance].concat(
      dryRun ? ["--dry-run"] : [],
    ),
  );
  if (sync.ok || dryRun) return sync.ok ? [] : [sync.message];
  const failed = failedSkills(sync.output);
  if (!failed) return [sync.message];
  const errors = [];
  for (const { slug, message } of failed) {
    const taken = takenVersion(message);
    if (!taken) {
      errors.push(`${slug}: ${message}`);
      continue;
    }
    try {
      const version = publishAtNextFreeVersion(taken, (next) =>
        run([
          "publish",
          `skills/${slug}`,
          "--slug",
          slug,
          "--version",
          next,
          ...owner,
          ...provenance,
        ]),
      );
      console.log(`${slug}: ${taken.join(".")} is taken, published ${version}`);
    } catch (error) {
      errors.push(`${slug}: ${error.message}`);
    }
  }
  return errors;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
