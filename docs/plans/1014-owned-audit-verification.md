# Owned audit verification record

Base: `0208e8f4127095bc258e00594a85386520baa1d5` (actual GitHub main). Producer: unmerged core PR #1007, `7a494e20e5fbb2df6b8bc6c7a1f7e6636e4ace04`. Existing feature branches were read only and preserved. Local `main` is not the base authority; use the frozen commit above.

## RED

- The genuine core's `owned-selection-started` event, with principal/credential/policy attribution and one candidate, reached the existing public append port and was rejected before SQL. Result: `failed/audit-unavailable`, queries 0, strategy selections 0, inference calls 0.
- An external frozen-base replay asserted the core's actual success status `invoked` and failed with actual `failed`. The original exploratory harness used an incorrect success spelling; the corrected frozen-base replay, not that spelling, is the regression evidence.
- Node 22.23.2: `node --experimental-strip-types --test test/owned-audit-projection.test.ts` before production edits: 1 pass, 3 failures, including `InvalidGatewayAuditEvent` on valid append and HTTP503 instead of200. Dependency installation preceded this behavioral run; the earlier missing-package error is not RED evidence.
- Additional targeted RED cases reproduced acceptance of a policy array with an inherited custom serializer and leakage of a throwing `kind` accessor's private error. Plain-array validation and fixed public append validation errors made the same rejection test GREEN without SQL access.
- A read-boundary RED case showed reserved attribution keys inside stored details could be hidden during flattening. SQL and HTTP read validation now reject these collisions before flattening; the same regression is GREEN.

## GREEN and failure barriers

- Final focused append/history/HTTP/CSV/acknowledgement and new owned cases: 98 tests passed, 0 failed/canceled/skipped, including disk-backed PGlite close/reopen, corrupted stored metadata, reserved-key collisions and database failure.
- Type checking passes. The external frozen-core verifier passes four scenarios: success (5 durable events, 1 selection, 1 offline inference), SQL failure and missing acknowledgement (1 attempted append, 0 selections, 0 inference, 1 test reservation completion), and denial (1 durable owned-denied event, 0 inference).
- The first full check with the machine's default temporary directory recorded 10,638 passes, 5 Codex authentication failures and 3 platform skips. Those failures are retained as evidence; the final check uses canonical `TMPDIR=/private/tmp`, with the final counts reported in the PR. No authentication tests were changed.
- These reservation ports and inference results are offline test doubles. No provider call, prompt transmission, Jev integration, installed PostgreSQL certification or operational acceptance occurred.

## Reproduce frozen-core compatibility

Prepare a temporary source overlay outside the repository. Extract only `src/routing/owned-route.ts` and `src/routing/owned-strategy.ts` from producer commit `7a494e20e5fbb2df6b8bc6c7a1f7e6636e4ace04`; symlink the other routing files and sibling source directories to this checkout. Do not modify an existing core worktree. The verifier checks SHA-256 for both extracted source files before loading them.

Run `node --experimental-strip-types scripts/verify-owned-audit-core.ts /absolute/temporary/overlay/routing/owned-route.ts` with Node22. This explicitly invoked verifier is outside the ordinary main test suite because its producer has not merged. The committed captured-event tests run in the normal suite without that dependency. A later core merge must rerun compatibility against its actual approved head; these frozen-source checks do not certify future changes.

## Remaining evidence

Required full-check and exact-head CI results, plus separate independent review, are recorded in the pull request. THE-18 reservations, THE-20 authenticated composition, installed PostgreSQL and operational recovery remain unresolved prerequisites; this slice does not mark them complete.
