# Canonical history model drilldown (#988, #637, #642)

## Issue and problem
Legacy #737/#756 implement model drilldown in usage-app.ts. Canonical history-app.ts does not expose it. Live open PR inventory checked before edits; reset985/987 and summary983 are distinct and unmerged.

## Scope and expected behavior
Own only canonical history row model action, new focused test and append-only contract/acceptance/PRD. Click reloads existing protected usage endpoint with exact row model intersected with applied principal, request and time bounds. It resets cursors via existing review.load. Self mode never adds row principal. Audit is unchanged. Model draft follows selected model; unrelated drafts remain unapplied. Existing generation/authority guards prevent detached action reuse. CSV and paging use the same captured model filter. No grant, session, runtime, DDL, endpoint or activation changes.

## Design
Reuse the established request drilldown pattern and existing usage client validation; do not port legacy workspace or new transport. The API and IAM remain authoritative. Dependencies: canonical main7479633 only; no dependency on unmerged legacy model-summary or reset/summary changes. Existing session/installed release decisions stay open. No new domain terms or irreversible decisions.

## TDD plan
RED mounted DOM tests for exact model URL encoding, principal/self and request/time intersections, fresh pagination, CSV, empty/error recovery, denial/disposal and stale controls. GREEN minimal row button using review.load. Run focused regression, typecheck, lint, planning and compatibility checks; attempt npm run check. Native browser with synthetic signed SSO and PGlite is separate from installed/live-provider acceptance.

## Delivery
Draft PR refs988/637/642. Independent exact-head approval, required CI and parent gates before merge. Rollback removes action; read API unchanged. No production or paid calls. Independent review stage follows implementation; source ownership announced in issue988, no peer acknowledgement claimed.

## Execution 2026-11-22 00:30 KST
RED six tests fail for absent model action. Initial GREEN found test query key typo (from/to instead of existing from_ms/to_ms), corrected assertion against existing client contract. GREEN three serial canonical suites50PASS0FAIL0SKIP. Four-suite attempt:50PASS plus workspace-integration process SIGKILL, not acceptance. npm run check stopped at default tsc Killed (137). Compiler single-threaded mode (--noEmit --singleThreaded) PASS; full lint PASS with existing42 warnings187infos, changed files clean. Planning/secret-scan, pinned compatibility, diffcheck PASS.
Native browser actual new bundled mount at loopback18746 with explicit two-row HTTP fixture: initial2records; clicking first model gives1record and exact model field including spaces/Unicode/+ and ampersand. Browser fixture log records encoded model; not authentication, SQL, installed or provider acceptance. PGlite/signed-SSO harness18745 failed to listen with empty log/no surviving process; no such success claimed. Other teammate tabs untouched. Logs /tmp/og-988-{red,green,focused,unit,fullcheck,typecheck,lint,dom,browser}.log.
