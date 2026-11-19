# Shared history workspace integration

## Issue and problem
- Issue: #642, parent #637. Usage and audit clients clear their own private state on fresh 401/403, but independent composition leaves the sibling history visible and callable after the trusted identity boundary is lost.

## Scope and expected behavior
- Add one workspace composing existing canonical usage/audit review modules and a caller-owned authorized request port. Fresh 401/403 in either JSON or explicit CSV operation clears both histories, aborts pending siblings, and terminally blocks the old port.
- Dispose on logout/known expiry/identity change. Recreate only with newly approved authority. Ordinary 400/500/transport errors remain local. Stale aborted requests must not terminate current work. Keep independent pagination/filter/export state.
- No login, session/CSRF/IdP decisions, DOM/navigation, runtime activation, SQL/schema, provider calls or deployment. Approved session/FE composition remains an external dependency.

## Design
- New history-workspace.ts only; reuse reviewed clients, query validation and wire projections. Shared response wrapper observes fresh denial before returning it, then disposes both children with intermediate notifications suppressed. A terminal immutable workspace snapshot is the UI boundary signal.
- No new IAM authority, resource names, retention or content-audit behavior. No domain term/ADR decision is introduced.
- Contract: ../../contracts/management-history-workspace.md; update PRD, architecture and acceptance with integration limitations.

## TDD plan
- Start with direct independent composition as a valid baseline; meaningful tests must fail for shared row removal, sibling abort and stale port lock, not missing imports.
- Test denial in both JSON/CSV directions, pending/late responses, stale aborted denial, 500/transport local failure, observer errors/reentrancy, disposal and canonical bundled execution.
- Add actual loopback signed-fixture SSO/migrated PGlite integration where feasible, keeping native browser/installed results separate.
- Run focused regressions, TypeScript, Biome, planning checker and attempt npm run check; full exact-head CI and formal review required before merge.

## Delivery
- Separate issue branch, DCO and Assisted-by disclosure, PR with RED/GREEN evidence. Removing additive integration is rollback; no persisted mutations.

## Verification checkpoint
- Direct independent-composition baseline: 3 pass / 11 behavioral failures / zero skipped. Failures establish sibling row retention, missing cancellation and old-port reuse rather than missing imports.
- Production workspace + focused tests: 18 pass / zero failures / zero skipped, including canonical bundled artifact against the actual owned loopback HTTP management runtime, signed fixture JWT, fresh persisted IAM, migrated PGlite, durable usage/audit access records and served artifact bytes.
- Full TypeScript passes. Further focused regression, formatting, planning and aggregate results are recorded in the PR/handoff. Native browser/company IdP/installed PostgreSQL/provider acceptance are not claimed.

- Expanded focused regression: 111/111 pass, zero skipped. Full TypeScript and planning checks pass. Aggregate check attempted: npm executable permission denied; corrected explicit CLI path is absent (MODULE_NOT_FOUND), before scripts. No aggregate pass, skipped check or toolchain repair is claimed; CI remains mandatory. Pending explicit sibling CSV cancellation cases added afterward and revalidated below.

- Final workspace suite after pending sibling CSV cancellation/disposal coverage: 20/20 pass, zero failures/skips; full TypeScript, changed-file Biome, planning and diff checks pass.
