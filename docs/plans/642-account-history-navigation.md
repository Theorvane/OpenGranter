# Account-scoped history navigation (#637, #642)

1. Preserve existing session, authentication, authorization and read-only API contracts. Do not activate browser login or infer read grants from Account identity.
2. Add an optional Account action that opens history for the exact validated principal ID. Capture identity in the current panel epoch; refresh/navigation/disposal invalidate detached actions.
3. Initialize usage and audit filters with this ID and load usage using the existing authenticated history client. Reject IDs outside the history-query contract locally without falling back to an unfiltered request. Keep manual History navigation unchanged and filters editable; tab changes and CSV use the selected filters.
4. Clear retained filter controls on redraw/disposal. Never preserve the account default across a manual navigation.
5. First run failing public DOM regressions, then implement the three owned modules. Run existing operations/history/token regressions and signed synthetic JWT + owned HTTP + migrated PGlite cases for success, fresh Deny and required audit failure. These are not installed PostgreSQL, browser login or live deployment evidence.
6. Commit as sjungwon03, open a stacked draft PR against 947's branch, request exact-head review, and require all required CI plus valid independent formal approval before any merge. Original whole PRD remains open.

Acceptance: Account -> View history for this account sends exact principal_id to usage and audit; 401/403 clears operations; 503 shows retry without private text; invalid history IDs cause no history request; stale controls do nothing; manual History has no retained default. No endpoint/schema/policy/session/paid call changes.

## 2026-11-19 main integration

1. Reconcile the existing Account history slice with main fdc0d1d after parent #947 was actually squash-merged; retain exact token prefill, request-scoped usage, mandatory audit and framed-GET rejection.
2. Resolve append-only documentation/test conflicts by preserving both behaviors. Do not change session, runtime, schema or activation contracts.
3. Re-run focused Account/history/HTTP regressions serially, strict TypeScript, Biome, planning and offline schema checks. Validate the integrated production bundle in native Chromium with synthetic loopback responses; distinguish this from installed login/deployment acceptance.
4. Push only the existing #948 branch, retarget to main, and require renewed exact-HEAD CI and independent formal approval.

### Integration evidence

The main-relative delta remains exactly the original three production modules plus two new tests, plan, contract and PRD link (8 files). Resolved old squash/add-add conflicts by keeping canonical main for unchanged historical files and tests; preserved both Account callbacks and main history retry/framing behavior. Serial Node 22.23 regressions: 55 DOM tests and 15 actual HTTP/synthetic signed-JWT/PGlite tests PASS, zero failures/skips. Full strict TypeScript, full Biome (42 existing warnings/181 infos), planning/link/fixture checks and six offline schema pins PASS. Native Chromium of a newly bundled production operations UI: exact encoded principal usage/audit, empty state, manual-history reset, detached input clearing, stale-action rejection, fresh 403, sanitized 503 and dispose PASS. The first harness expected the wrong exact 503 text; corrected the harness to the existing production text and reran all three scenarios successfully. The first test command used system Node 18 and rejected the strip-types flag before running tests; supported Node 22 runs passed. No full local suite or installed IdP/PostgreSQL/deployment/provider acceptance claimed.

## 2026-11-19 CI clock determinism repair

Exact integration HEAD 08d06de failed the full CI suite because the logit-bias operational-leak assertion found token ID 50256 inside a legitimate wall-clock occurredAt (1795068350256). Reproduce that wall clock against the existing public HTTP test, then pin only the fixture handler clock through its existing now port. Preserve the full sensitive-value assertion and all real adapter/API behavior. Run the same adversarial wall clock after the repair, the focused Account/history regressions, strict types, lint and planning checks; require fresh exact-head CI and independent formal approval. No production behavior or permission/session/schema change.

Repair evidence: forcing Date.now to 1795068350256 reproduced five failures (13 pass / 5 fail) in the unchanged 18-case logit-bias public-boundary suite. With the fixture now port fixed, the identical forced clock passed all 18 with no weakened assertions. Combined focused suite passed 74/74, zero failures/skips; strict full TypeScript, full Biome and planning/link/fixture checks passed. The previous full CI failure is not evidence that fresh CI passed.
