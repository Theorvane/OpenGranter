# Preserve existing reader scope hardening

## Issue and problem

- Issue: #1006; existing proposals #838, #839 and #930, requirements #637/#642.
- Current canonical audit reader already owns scalar query fields before SQL,
  but its original dedicated mutation regressions are absent. Current usage
  reader still reuses caller-owned query and nested cursor fields after await.
  This can accept substituted rows or change page interpretation under a
  mutated scope. It is defense in depth, not remote JavaScript object access.

## Scope and expected behavior

Preserve both original dedicated regression files. Apply only #838's existing
small query/nested-cursor snapshot to the current usage reader. Keep the audit
reader's current shared projector and complete-page guard from #1011 unchanged.
SQL parameters, validation and post-await projection must use one owned scope.
Independent pending calls stay isolated. Invalid input/SQL results remain
private failures; valid SQL/PGlite reads retain success and pagination.

No new feature, endpoint, query field, permission, schema, route/provider,
session, UI, listener, deployment, retry or accounting policy. Parent product
requirements and Router #7/THE-10/#1007 remain open and untouched.

Current canonical history already supports #930's loading-only cancellation,
same-attempt explicit retry and stale/terminal fencing through `cancelRead`.
Preserve its original dedicated controller regressions, including actual
loopback Fetch abort/retry and reentrant observers, by adapting only the old
method name `cancelLoad` to the existing canonical name. Existing canonical DOM
tests retain the user control, drafts, late results and streamed-body cases.
Do not add a second cancellation API or restore the old history UI.

The imported regressions exposed two still-missing reentrant-disposal fences:
current cancellation can publish cancelled after an abort observer disposes
the controller. The original #930 patch already includes a revision/blocked
check after abort. Apply only that existing fence to both canonical cancelRead
methods after recording expected RED; preserve terminal idle/disposed state.

## Design

Start from frozen #1011, then integrate its actual main merge before publishing
this separate bounded replacement. Copy original tests first and run expected
RED on unchanged usage code; current audit tests should already pass. Then
apply the original snapshot only, without restoring old cumulative source.
Preserve scalar presence and copy cursor coordinates before any asynchronous
SQL. Reuse current contracts and document this boundary, not product authority.
No unresolved architecture decision is settled.

## TDD plan

1. Run original usage snapshot tests before production changes: mutations of
   principal/model/request/time/limit/cursor and substituted rows should fail.
2. Run original audit snapshot tests to establish current absorption and retain
   their real SQL/public reader assertions. Adapt only genuine fixture drift,
   with explicit evidence and no weakened assertion.
3. Apply the original small usage snapshot and rerun both GREEN; cover existing
   reader, SQL ledger, scoped HTTP, success/denial/failure and pagination.
4. Run strict types, lint, planning/links/secret scan, compatibility and diff.
   Fresh exact-head full CI and independent sjungwon03-ai review are required;
   focused results are distinct from previously failed local aggregates.

## Delivery

Owner-authored issue-numbered branch and PR with authorized owner DCO and
Assisted-by: Codex. Code/issue/PR actions use command-local sjungwon03; reviews
only sjungwon03-ai. Source838/839/930 remain open until validated replacement merge
and explicit mapping. No historical approval reuse or branch deletion.
Rollback removes this snapshot and its isolated tests without reverting other
main hardening. No release or deployment acceptance is claimed.

## Recorded verification

Original audit snapshot11tests already passed unchanged. Original usage snapshot10tests failed for expected scope/order/substituted-row behavior, then all10 passed after the original snapshot. Initial RED preserved9 reported failures before the final concurrent SQL case hung during early-rejection cleanup; the owned focused process was terminated at about60s. The fixture now awaits both operations with allSettled before closing its shared PGlite connection, then asserts both fulfilled. Corrected complete RED:11PASS/10FAIL; no production changes before that run. Dedicated+existing SQL readers GREEN46PASS/0FAIL/0SKIP.

Original #930 tests adapted only cancelLoad→cancelRead exposed2 missing reentrant-disposal fences (28PASS/2FAIL with existing canonical cancellation tests). Adding the original post-abort revision/blocked guard makes cancellation/CSV/tab/refresh51PASS/0FAIL/0SKIP. The original actual loopback abort/retry, same-cursor retry, loading observers, stale versus fresh denial and disposal assertions remain. Existing DOM tests cover the canonical control and drafts; the old mount is not restored.

Strict types, full lint, planning/links/contracts/fixture-secret scan and all six pinned compatibility checks passed. Full exact-head CI, fresh cumulative AI review and actual-main integration are still required; no successful full local aggregate is claimed. Sources838/839/930 stay open until replacement merge and coverage mapping.
