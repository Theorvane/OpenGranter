# Usage attempt inspection in management history

## Issue and problem
- Refs #637 and #642. Original PRD Usage requires per-attempt identity, destination, outcome, latency and token counts. The existing protected history API publishes these fields but the screen hides them, preventing investigation of failures and fallback attempts.

## Scope and expected behavior
- Add a native disclosure to each usage row showing attempt ID, route kind, recorded upstream target, selected candidate, reported inference provider, outcome, latency, input/output/total token counts and usage availability. Null means Unknown; zero stays zero. The recorded upstream target is not a claim about the actual model served.
- Do not show raw credentials, policy JSON, prompts, responses, or arbitrary extra fields. Text-only rendering. Use only the already-validated scoped usage response; no new fetch, auth, schema, retention, paid calls, or public entry activation.
- Preserve existing exact cost comparison, filters, paging, exports and identity teardown. Re-rendered rows must not retain old disclosures.

## Design
- New usage-record-details.ts appends a native details/summary and labelled definition list; history-app.ts calls it for each validated row.
- Prefer native disclosure over a new async endpoint or custom toggle: the data is already authorized and fetched. No new decisions about IAM, sessions or billing.
- Dependencies: existing trusted caller and scoped SSO usage service. Installed session acquisition and approved ingress remain unresolved.
- Update PRD, architecture, acceptance and contracts/management-history-workspace.md.

## TDD plan
- RED: history mount lacks the disclosure and required outcome/count labels.
- GREEN: populated/zero/unknown values, partial/missing/invalid counts, managed/delegated distinction, literal markup, no incidental credential or policy display, disposal/denial and fresh loads clear detail rows.
- Integrate with actual local SSO HTTP handler and embedded PostgreSQL usage ledger; distinguish this from installed PostgreSQL/real IdP acceptance.
- Run focused tests, full typecheck/lint, npm run check, planning and compatibility checks.

## Delivery
- Isolated branch feat/642-canonical-usage-inspection; one focused PR. Exact-head CI and independent formal approval before merge.
- Revert import/call and new helper to roll back. No database or API migration.
- Record local versus CI versus installed evidence separately; no actual-model/provider or deployment certification from synthetic metadata.

## Execution evidence (2026-11-13 21:30 KST run)
- RED: six behavior tests failed because the attempt disclosure was absent (/tmp/og2130-red.log), after correcting a test-only unsupported parameter property before the behavioral run.
- GREEN: seven focused tests pass, zero skips, including actual loopback HTTP, fixture signed JWTs, all migrations and PGlite persistence; foreign-principal isolation and fresh policy denial with durable ready/forbidden audit were verified (/tmp/og2130-http.log).
- Broad management/SSO usage suite: 507/508 passed, zero skips (/tmp/og2130-focused.log). The only failure is the existing CLI artifact test because installed npm cannot find walk-up-path. npm run check fails before repository scripts for the same environmental dependency (/tmp/og2130-check.log); not a full local PASS.
- Full direct TypeScript check passed (/tmp/og2130-tsc.log), full Biome exits 0 with existing warnings/infos (/tmp/og2130-lint.log); planning checker, six compatibility pins and git diff --check passed.
- Native Chromium preview http://127.0.0.1:18815 uses the canonical browser builder and synthetic data, not authentication or deployment. Mouse expansion and keyboard Space collapse verified; zero, Unknown, failed, partial and literal script-like target display correctly. Temporary preview entry removed before commit; artifacts /tmp/og2130-web.
- CI and independent formal review remain required on the exact submitted HEAD. No merge, real IdP, installed PostgreSQL, provider request or user-accessible deployment certified.
- Final targeted history/operations lifecycle integration: 73/73 passed, zero skips (/tmp/og2130-final-focused.log).

## Historical integration boundary
PR #702 already proposed inspection on a legacy usage-app.ts branch. Current main uses canonical history-app.ts and contains neither legacy source module. This ports that existing product behavior into the current canonical mount rather than activating a second screen. The old remote branch is preserved; initial push was rejected non-fast-forward and no force push occurred. This branch is based on current main and changes only the eight declared files; it must not be merged with the stale legacy implementation wholesale.
