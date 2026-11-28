# Canonical operations page exit

## Issue and problem
Issue #990; refs #637 and #639. Canonical PR989 lacks PR981's pagehide handling in the trusted operations adapter, leaving Account and History authority alive in retained documents. Integrate the existing source behavior, not a new session contract.

## Scope and expected behavior
Pagehide terminally disposes the complete adapter, clears private DOM, aborts pending reads and releases timers/download ownership. Retained controls, pageshow and authorize on the disposed instance cannot revive authority. A fresh trusted caller and new adapter are required. No login acquisition, public entry, backend, runtime, DDL, IAM, mutation replay, deployment or paid calls. Teardown does not revoke credentials or prove mutation rollback.

## Design
Port only the operations-session.ts change and public-boundary tests from unmerged PR981 onto canonical PR989. Own that file and test/canonical-operations-page-exit.test.ts; do not edit history-app, shell or other teams' source. Issue990 records proposed ownership, not acknowledged coordination. PR981 is not wholly superseded or approved. No new domain terms or irreversible design decision. Depends on exact PR989 0b27a01116b8e71c8d264f4daabac1fc17a59319; independent exact-head review, CI and parent gates required. Contracts: contracts/management-operations.md; docs/acceptance.md and docs/architecture.md. Alternative: leave cleanup to token child, rejected because Account/History survive it.

## TDD plan
Import PR981 public mount tests unchanged and run against canonical baseline: expect missing pagehide disposal/observer failures. Cover persisted/nonpersisted exits, pending ignored-abort Account, ready Account, pending mutation with no replay claims, replacement grants, sibling observers and absent browser. Port minimal production diff then run focused canonical/session/HTTP regression, strict types, lint, docs, compatibility, bundle and npm run check. No weakening of existing tests.

## Delivery
Record red/green and exact SHA in PR and handoff. Attempt native browser evidence separately; synthetic DOM/HTTP is not installed E2E. Rollback removes this integration only; do not reset other work. No merge until exact-head CI, independent formal approval and parent dependencies pass.

## Execution evidence — 2026-11-22 10:00 KST
PR981 production diff ported only to operations-session.ts. Original seven tests produced baseline RED0PASS7FAIL. Initial canonical GREEN70PASS1FAIL exposed a source-test assumption: completed history request controllers are released on canonical code, unlike source981 stack. Changed the sibling/replacement test to keep reads pending, testing actual cancellation rather than demanding abort on an already completed request. Reran exact adapted baseline by temporarily restoring only production HEAD source with finally restoration: RED0PASS7FAIL /tmp/og-1000-red-final.log. Final six-suite regression71PASS0FAIL0SKIP /tmp/og-1000-green-final.log, including existing signed synthetic SSO/migrated PGlite loopback HTTP. Not installed PostgreSQL/company IdP/browser acceptance.

Full strict single-threaded TypeScript, full lint, planning/link/secret checks, pinned compatibility and explicit operations-session browser bundle PASS (/tmp/og-1000-{types,lint,docs,pins,bundle}.log). npm run check passed types/lint then reached test4119 before110second timeout exit124 /tmp/og-1000-fullcheck.log; no aggregate success. Native browser navigation timed out; desktop2026-11-22T01:05:14Z showed Chromium Aw Snap error9. No restart, installed access URL, live provider/paid calls or deployment. Shell first used system Node lacking strip-types; switched to installed Node22. Initial fullcheck status-print command refused before execution due to protected shell interpolation, then corrected once without interpolation.
