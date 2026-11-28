# Consolidate existing boundary hardening

## Issue and problem

- Issue: #1006; cleanup tracking: THE-12.
- Retained PRs #857, #860, #919 and #925 contain small existing changes whose
  actual merge conflicts against main are documentation-only. They remain
  useful; conflicts are not evidence of obsolescence.
- Preserve their original issue-specific plans, meaningful tests and bounded
  production changes without restoring historical source trees.

## Scope and expected behavior

- #857 / #856: reject incomplete audit metadata pages instead of silently
  filtering invalid rows into a partial successful page.
- #860 / #853: allow explicit reviewed public browser sources while retaining
  source containment, ungranted-source and node/package denial, and the fixed
  reviewed default closure. Each extra exact source is the trusted build
  caller's publication decision, not a secret scan or arbitrary server-code
  approval. No automatic source-boundary expansion.
- #919 / #640: bound authenticated credential request-body consumption and
  settle aborted/stalled uploads without dispatching a mutation.
- #925 / #640: reject incomplete or malformed token-actor snapshots before
  policy/mutation work; preserve valid actor success and explicit Deny.

No new feature scope, provider adapter, model discovery API, routing policy,
permission grant, session/SSO decision, usage accounting, runtime activation,
DDL or deployment. Preserve final-provider IAM/Deny, quotas, required audit,
private errors and secret/content non-disclosure across all existing paths.

## Design

Start from actual main `a835c0b0cad3cf08976baf660030e2b5fa5c86ed`. Copy only
the original dedicated regression files first and run each separately to
establish expected RED evidence. Then apply the original small production
deltas through three-way integration, preserving current source and #767's
content-coding guard. Keep the four original numbered plans/contracts and
append their new bounded behavior to current docs rather than replacing
unrelated current documentation. Resolve no product architecture option.

Integrate actual latest main again before publishing, including the separate
runtime/refresh test-only batch. Freeze the cumulative head for independent
review; source PRs stay open until validated replacement merge and mapping.

## TDD plan

1. Run original audit-page completeness tests on current main; expect partial
   malformed pages to be accepted or filtered instead of rejected.
2. Run original reviewed-browser-source tests; expect missing explicit source
   support/validation to fail without changing private-source denial.
3. Run original credential body-deadline tests; expect stalled authenticated
   body consumption not to settle before the caller's bounded deadline.
4. Run original token-actor completeness tests; expect malformed snapshots to
   reach policy or mutation work instead of being rejected early.
5. Preserve exact failure evidence, apply the smallest existing source patches
   and rerun each GREEN. If failure is caused by fixture drift rather than the
   intended behavior, record and adapt only the fixture without weakening its
   assertions or inventing a product requirement.
6. Run related success, denial and failure suites, strict types, lint, planning,
   compatibility and whitespace checks. Fresh exact-head full `npm run check`
   CI and independent approval are required; focused results are not a full
   local aggregate pass. No provider calls or paid credentials in tests.

## Delivery

Keep this production hardening separate from #1009's test-only preservation.
Use human author/committer `sjungwon03`, authorized human DCO and
`Assisted-by: Codex`. Code/issues/PRs use command-local verified `sjungwon03`;
independent reviews use only `sjungwon03-ai`. No company account, global
account switch, alternate review identity, force push or branch deletion.

Merge only after current-main, unchanged-head/diff, required checks, fresh
review and unresolved-thread gates pass with a matching-head guard. Close
source proposals only with their actual implementation/test mapping, and close
only demonstrated narrow issues #856/#853 when their acceptance is complete.
Broad #641/#642/#643/#116 and owned Router #7/THE-10/#1007 remain untouched.

Rollback removes only the mapped bounded changes and their tests; it must not
revert other main integration work or weaken existing authorization/audit.

## Recorded red and green evidence

All original regression files were committed and run on main `a835c0b` before
applying production changes. The failures matched their intended boundaries:

| Source | Baseline RED | Dedicated GREEN |
| --- | --- | --- |
| #857 | 2 pass / 10 fail: missing positions accepted | 12 pass / 0 fail |
| #860 | 8 pass / 3 fail: explicit reviewed-source support/validation missing | 11 pass / 0 fail |
| #919 | 13 reported failures, including live-socket timeout; baseline process stopped at the explicit 60-second harness bound before a final summary | 17 pass / 0 fail, including live sockets |
| #925 | 4 pass / 34 fail: incomplete actor collections accepted or failed after boundary work | 38 pass / 0 fail |

The combined 13-suite related run passed 315 tests with zero failures,
cancellations or skips. Strict types, full lint, planning/link/contract/fixture
scan, six pinned compatibility checks and whitespace checks passed. Production
delta remains the five original files (85 added / 26 removed lines); current
content-coding and cleanup guards remain intact. Documentation conflicts kept
both independent current and new topics, with peer headings where appropriate.
Clarify that explicit public-source grants preserve the pre-existing fixed
reviewed closure rather than implying no fixed shared source exists.

Fresh latest-main integration, CI and independent exact-head review remain
mandatory before publication/merge; these focused results are not a full local
aggregate success claim. No historical approval is reused.
