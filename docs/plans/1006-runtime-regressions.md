# Preserve remaining runtime and refresh regressions

## Issue and problem

- Issue: #1006; cleanup tracking: THE-12.
- PR #855 at `28ed0cd68086897d489d8e11a967fcbbdb151dfc` has no remaining
  production delta, but its owned-listener expired/unbound-token assertions
  are not explicit in the current canonical integration tests.
- PR #926 at `9b53413566d3a0516708d6d1ea1a8d5181a52526` has no remaining
  production delta, but retains useful ready/empty Usage/Audit refresh,
  current-page CSV and stale-control assertions.
- Preserve those bounded assertions before closing the source proposals.

## Scope and expected behavior

No product behavior changes. Add expired and unbound signed-JWT usage JSON/CSV
requests to the existing owned-runtime fixture, asserting no usage read,
private no-store rejection and single connection ownership. Port the existing
refresh regression file against canonical history, preserving its assertions.
Adapt only the UTC field labels and dispatch the real input event in its test
helper to match the current native form and draft capture behavior.

Permissions, secrets, audit/usage accounting, API contracts, sessions, runtime
activation, provider calls and deployment remain unchanged. No new domain
decision or ADR is needed; broad delivery requirements remain open.

## Design

Use the actual latest main and preserve #1008's separate test-only integration.
Keep current production files untouched. Extend the current runtime fixture
rather than restoring the old 230-line runtime file. Port the refresh tests
as an additive file, with no assertion weakening or historical source tree
replacement. Keep source PRs and issue #854 open until replacement merge and
an explicit source-to-current coverage mapping.

## TDD plan

This preserves tests for already implemented behavior, so no new production
RED/GREEN cycle is claimed. Run the owned-runtime and refresh public-boundary
suites, existing canonical history regressions, strict types, lint, planning
and whitespace checks. Required exact-head CI runs full `npm run check`; no
full local success is inferred from focused results. Record failures and any
test-harness adaptation separately from product defects.

## Delivery

Use a new owner-authored numbered branch and PR, integrate the actual main
after #1008 merges, then freeze the head. Require fresh CI, independent
`sjungwon03-ai` approval and matching-head squash merge. All code/issue/PR
operations use command-local verified `sjungwon03`; no company account,
global account switch, other review actor, force push or branch deletion.

Source #7/THE-10 and Router #1007 remain outside cleanup. Rollback removes
only these tests and this plan; no production behavior is affected. Close
only the demonstrated narrow implementation issue, not #641/#642/#643/#116
or other unfinished product requirements.

## Porting evidence

The initial fixture used a token expired by one second and expected 401, but
the existing RFC9068 validator intentionally permits 60 seconds of clock skew.
That was a test setup error, not a newly found product defect. Preserve the
source PR's expiry rejection and unbound signed-subject assertions without
changing production expiry semantics. Use coherent fixture times: issuance
600 seconds ago, authentication 700 seconds ago, and expiry 120 seconds ago.
This isolates expiry beyond the skew allowance while staying within the
existing maximum age and lifetime, avoiding unrelated chronology failures.
Keep the no-usage-read and private response assertions for JSON and CSV.
Refresh fixture adaptations change only current UTC labels and real input
event dispatch, not assertions.

## Current-main integration

Integrate actual main `a835c0b0cad3cf08976baf660030e2b5fa5c86ed` after #1008
merged, preserving its complete cleanup/catalog regression coverage. The
post-integration five-suite run passes 44 tests with no failures or skips.
Only this plan and the two runtime/refresh test files differ from that base;
production, scripts and contracts are unchanged. Record strict types, lint,
document checks and fresh full CI/review in the PR before guarded merge.
