# Canonical Usage-to-Audit request investigation

## Issue and problem
Issue #996, original #637/#642. Usage displays exact request IDs but cannot open the corresponding authorized Audit decisions. Reuse the existing Audit client and canonical mount; no new API or domain terms.

## Scope and design
Add a Usage row action for its exact request ID. Intersect with destination applied Audit principal/model/time/page size, never copy Usage principal or mutable drafts. Discard destination drafts/cursor; use canonical select to cancel departing CSV and issue a fresh Audit read. Preserve existing JSON coalescing behavior. Explain that no visible audit is not proof of no decision or complete history. Independent Audit authorization remains mandatory.

No new session/runtime/DDL/activation, production deployment, provider call or policy decision. Existing approved caller owns authentication and teardown.

## TDD plan
Public mount RED before production edit: missing row action. Cover exact encoded request, destination scope, drafts/cursor reset, fresh load, empty, failure/retry, 401/403 cleanup, pending read cancellation/disposal, departing CSV and retired controls. Run reverse-direction and history regressions, changed-file lint/planning and standard full check. Record local limits separately from CI and actual deployment.

## Delivery and rollback
Stack on draft #995 exact42e109d643381303846c31fa6fd84f7475f0566f. Require satisfied parent chain, latest-head required CI and independent formal approval. Remove action and warning to roll back; no storage migration. Full original PRD and installed browser/IdP/PostgreSQL/provider E2E remain separate incomplete gates.

## Validation 2026-11-23 06:00 KST
Initial public-boundary RED: 0 pass / 8 fail, missing action. After production integration, the initial Unicode request fixture was rejected by the existing Audit request-ID contract; corrected test data to the already-supported encoded ASCII request (no validator relaxation). Pagination fixture corrected to the existing numeric Audit cursor contract, not a Usage cursor. Final five-file regression: 34 pass / 0 fail / 0 skip, including ten new cases. Changed-file Biome has no warnings. Synthetic browser production bundle at loopback19690 PASS: destination scope, cleared drafts, retired controls, fresh denial cleanup, disposal (7 requests). Not a user access URL, real API/login/IdP/PostgreSQL/provider/deployment acceptance.

Standard npm run check attempted on this change with explicit Node22 toolchain and capped native compiler concurrency: typecheck killed, exit137; later chained stages did not execute. Separate full Biome completed with existing repository warnings/info (53 warnings,202 infos), changed files clean; planning/links/contracts and pinned OpenRouter compatibility passed. No local fullcheck/typecheck success claim.
