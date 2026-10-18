# Stabilize schema CLI checks on Node 22.14

## Issue and problem

- Issue: [#496](https://github.com/Theorvane/OpenGranter/issues/496).
- The supported minimum Node 22.14.0 emits an experimental type-stripping warning in the child processes used by the schema CLI conformance suite. Its 17 exact stderr assertions then fail, although the command's safe diagnostics are correct. The global `NODE_NO_WARNINGS=1` workaround from #494 hides unrelated process warnings.

## Scope and expected behavior

- Give only the affected CLI test child processes Node's `--disable-warning=ExperimentalWarning` option alongside their existing experimental type-stripping option.
- Retain exact stdout/stderr, exit-code, single-download, no-secret and unchanged-pin assertions for successful, drift and failure cases. No captured diagnostic filtering or global suppression is introduced.
- Production CLI invocations, source pins, client API, IAM, secrets, usage and audit behavior do not change. This is a test harness correction, so no product requirements or domain terms change.

## Design

- Set the targeted runtime option explicitly in both existing child command argument lists: the offline command and the controlled live command. The latter uses a fixture download and never calls a live provider.
- Prefer the narrow child-process option over a suite-wide environment change or stripping stderr after capture. Production warnings and ordinary child-process warnings remain observable; exact application diagnostics remain asserted.
- Update [coding](../coding.md), [acceptance](../acceptance.md), and [compatibility](../openrouter-compatibility.md). No architectural trade-off requires an ADR.

## TDD plan

- Run the current 17 conformance cases on Node 22.14 with `NODE_NO_WARNINGS` and `NODE_OPTIONS` absent; record failures containing the runtime warning.
- Apply the two argument changes, rerun the same command and confirm all 17 cases pass without a global workaround.
- Run plain `npm run check` under that same environment, including all three offline schema integrity gates and the planning checker.

## Delivery

- Publish the issue branch and a PR linking this plan with red/green results and full-check evidence.
- Scope limit: the warning option suppresses experimental warnings within these isolated conformance children. It is not added to production commands or other test processes; this does not certify all Node versions or full OpenRouter compatibility.

## Verification evidence

- Red: Node 22.14.0 with `NODE_NO_WARNINGS` and `NODE_OPTIONS` removed failed all 17 existing conformance cases because type-stripping warning text preceded the expected stderr.
- Green: the same focused command passed all 17 cases after setting the child-only warning option. Exit/status/diagnostic and no-pin-write assertions were not changed.
- Full gate: `npm run check` with both warning environment overrides absent passed strict types, lint, 6,617 tests with one optional external PostgreSQL skip, planning/contracts checks and all three pinned schema integrity checks. Runtime warnings still appeared in the parent/production command output, confirming no suite-wide suppression.
