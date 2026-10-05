# Scoped check

```sh
hyperframes check --range 7.8,8.2 --components '#title,#logo' --json
```

`--range start,end` uses global seconds and must lie inside the resolved composition duration. It bounds regular layout/contrast sampling, transition samples and the dense content-overlap grid. Explicit `--at` samples are intersected with the range; an empty intersection errors. Static lint remains project-wide. Whole-film motion-spec assertions and frozen-sweep detection are explicitly skipped in a range check; rotation/geometry checks still run on the scoped samples. Initial browser loading may initialize the playhead outside the interval; reported audit sampling is bounded.

`--components` accepts a CSS selector list (including selectors containing commas inside CSS functions). It keeps the entire scene loaded and evaluates the full check. Only browser finding details are filtered: a finding is included when its subject OR its collision/occluder/container counterpart belongs to a selected component or descendant. Invalid or unmatched component selectors fail the browser check. Unresolved selectors, project-level runtime errors and static lint remain visible. Membership is resolved against the loaded DOM; this version is intended for HF's stable DOM compositions, not arbitrary scripts that reparent/delete nodes over time.

Counts, overall `ok` and the process exit code retain the full check result even if all detailed errors are outside the filter. `scope.hiddenFindings` explains omitted details. Apply the normal `--max-issues` limit after component filtering so unrelated issues cannot consume the display budget. This is filtering, not suppression.

No automatic report persistence or rule-selection flag is added. Existing `--json` remains the complete returned report for the selected output scope.

Validation: command and browser-driver tests, static typecheck, plus real Chromium check on a four-second fixture with an unrelated overlap. The scoped output omitted the unrelated finding while retaining failure, and its reported samples stayed within 1–2 seconds. The DSH plugin test also exercised native Write -> this CLI -> Chromium -> complete JSON tool return.
