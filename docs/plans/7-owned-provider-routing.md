# OpenGranter-owned provider routing

## Issue and problem

- Issue: [#7](https://github.com/Theorvane/OpenGranter/issues/7), [THE-10](https://linear.app/theorvane/issue/THE-10), Orca item170.
- Existing managed/delegated routes separate selection ownership and cannot select OpenRouter alongside direct providers.

## Scope and expected behavior

- Deliver an opt-in core with a shared strategy interface, administrator priority and stable ID tie-breaking, bounded OpenRouter attempts, and optional research-only Jev recommendation.
- Preserve existing IAM, adapters, audit and per-attempt usage. Require eligibility evidence and reservation ports. Default Deny and final-provider permissions apply alongside transport-provider permissions.
- Do not switch the existing gateway or claim production readiness. Persisted configuration, gateway composition (including durable projection for the new owned audit events), reservation infrastructure and frontend controls are subsequent slices.
- Jev is disabled by default, shares no prompt by default, rejects production use, and falls back on every unsupported or failed answer. No live experiments.

## Design

- Snapshot trusted registrations and candidate eligibility; filter before reservation and strategy. Reuse the managed invocation executor with a bounded adapter dispatch port.
- Strategies choose only an eligible ID; deterministic order governs all remaining attempts. Price, latency and health ranking can extend the interface without changing authorization.
- Sanhouse uses state/instruction/options. Decoding is an injected port, absent by default. Infra subsequently supplied a historical nonidentifying fixture; an explicit research consumer decoder validates that observation without claiming a stable server schema or production correctness.
- ADR 0009 supersedes the route-kind selection restrictions in ADRs 0003 and 0005 for the opt-in core. Existing persisted routes retain their implementation until migration.

## TDD plan

- First test: deterministic priority and ID tie-breaking through the public core; expect missing-module failure before implementation.
- Cover model/transport/final-provider denial, capability/health/quota exclusion, disabled zero calls, invalid and failing Jev fallback, reservation denial/failure, usage failure, bounded OpenRouter invocation, and no replay after response start.
- Run focused Node tests, then npm run check. Record red/green evidence and remaining infrastructure prerequisites.

## Delivery

- Add tests, strategy core, adapter dispatch, and contracts; validate and open a reviewable PR.
- Required reservation port must reserve enough for all admitted attempts and reconcile possibly billed failures. The repository supplies no concrete reservation implementation; a boolean check is insufficient.
- Rollback: stop opting into the new exported core; existing gateway remains unchanged.
- Remaining risks: historical Jev fixture is not a server schema guarantee; research-only endpoint, durable reservations and deployment integration are unavailable in this slice. Jev decision-service cost accounting remains separate integration work.

## Red/green evidence

- Initial owned and Sanhouse public-boundary suites failed with expected missing-module errors before their implementation.
- Additional regressions failed with `1 !== 2` missing unbilled-attempt usage and `1 !== 0` strategy execution before required audit. Added opt-in failed-attempt capture to the existing executor and moved selection-start audit before strategy invocation; both now pass. Subsequent red cases exposed missing strategy audit attribution and silent omission of required accounting by untyped composition; both now pass.
- `node --experimental-strip-types --test test/owned-routing.test.ts test/sanhouse-strategy.test.ts`: 16 passed on Node 22.23.2; `npm run typecheck`: passed. Changed-file Biome checks have no diagnostics. No live inference or Jev calls.
- Initial full run on the environment's Node 26 reported existing Codex-auth fixture failures caused by macOS's symlinked `/var` temp path; reproduced in isolation on Node 22, then all 13 applicable auth tests passed with canonical command-scoped TMPDIR (two platform skips). Restarted the full check on Node 22 with canonical TMPDIR; no auth code changes.
- Final serialized `npm run check` passed (exit 0) on Node 22.23.2 with canonical command-scoped TMPDIR: 10,308 tests, 10,305 passed, three skipped, zero failures/cancellations, plus typecheck, lint, planning/link/secret checks and all six pinned OpenRouter schema checks. Validated implementation HEAD: `50a5c74f95d801fe5d78205df750ad798efa12e6`; refreshed origin/main base: `7479633f78408db2d552df71d417b3a553ba6c1f` (already integrated). Existing repository-wide lint warnings remain; changed-file lint has no diagnostics.
- Main subsequently advanced to `af36d2c01860196dae7d46545805af961ab4d464` (#1005). Rebased cleanly, preserving the routing source/test delta. A second authorized serialized `npm run check` passed (exit 0) on integrated HEAD `654ae909afb3f776da3dab0448446a1225733132` (implementation `b92edd6`): 10,460 tests, 10,457 passed, three skipped, zero failures/cancellations, plus all other check stages and six pinned schema gates. Only this plan's validation record changes afterward; the planning checker is rerun for that documentation update.
- The aggregate Node 22 run completed with 10,308 tests: 10,303 passed, two timeout cancellations and three skips (exit 1). The cancellations were existing 15-second PostgreSQL shutdown cases during overlapping host suites; both pass isolated: canonical shutdown 11.6 seconds, direct-runtime shutdown 9.4 seconds. No unrelated timeout changes are included. The coordinator authorized a serialized final full-suite window after other workstreams finished.
