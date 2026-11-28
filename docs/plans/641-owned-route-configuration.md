# Persisted owned-route configuration (THE-17)

## Issue and problem

- Reuse [#641](https://github.com/Theorvane/OpenGranter/issues/641); bounded backend slice tracked by [THE-17](https://linear.app/theorvane/issue/THE-17).
- The opt-in core in PR #1007 has no persisted configuration/publication API. Existing managed/delegated storage and discovery remain authoritative for the default gateway.
- Complete paginated open/closed PR inventory on 2026-11-28 found no competing owned-configuration implementation. PR #1007 remains OPEN at `7a494e20e5fbb2df6b8bc6c7a1f7e6636e4ace04`, approved with seven successful checks and behind main; preserve its branch and PR.

## Scope and expected behavior

- Persist bounded immutable complete provider/route revisions and a separate publication pointer. Authenticate active SSO humans and evaluate explicit read/write/import/publish permissions using current IAM; administrators have no bypass.
- Store only trusted registered credential references, approved HTTPS origins, and approved model/final-provider mappings. Reject unknown fields, duplicate IDs, unsafe priorities, unsupported strategy settings and unverified mappings.
- Mutation and success audit commit together; mandatory denial audit failure fails closed. Reads include configuration only, never provider secrets, prompts, health claims or budget guarantees.
- Exclude gateway activation, UI, inference calls, live Jev, reservations and owned inference audit projection (THE-18/19/20/21).

## Design

- Immutable complete revisions avoid mixed provider/route snapshots. Publication uses an explicit expected published revision and a separate monotonically increasing publication generation to prevent ABA races. Rollback revalidates the saved revision against current administrator attestations and republishes it through the same CAS/action.
- Coordinator confirmed these implementation choices within existing scope on 2026-11-28 (message `msg_1a2655888be1`); this is not new human authorization: explicit opt-in legacy draft import only, no conversion of active pointers or policy snapshots; reject unsupported/ambiguous input. Import captures legacy route version and supplied policy-version provenance in an immutable revision.
- Research Jev settings default disabled and private. Enablement/production settings are rejected in this API; a separate prompt-sharing field is consent metadata only and grants no permission to call or transmit prompts.
- Trusted deployment registries attest exact provider kind/origin/credential reference and exact alias/transport/final-provider/model/slug mapping. HTTP input cannot attest itself; publication and rollback revalidate current registry state inside the transaction.
- Implement independently on current main without copying or merging unmerged core code. Semantic dependency on PR #1007 is explicit: saved configuration does not activate or certify that core. Runtime translation/composition is THE-20 work.
- Open dependencies: deployment approval/provisioning of registry attestations, real PostgreSQL installed acceptance, production reservation/audit/discovery integration and eventual gateway activation remain unresolved outside this slice.
- Contract: [owned-route-configuration](../contracts/owned-route-configuration.md). Relevant product/architecture/acceptance documentation will describe saved/published versus runtime state.

## TDD plan

- First RED: public authenticated configuration API cannot create/read an immutable revision because the module does not exist; run and record failure before implementation.
- Public-boundary cases: active admin read/write/publish/import; missing/inactive/revoked identities; implicit and explicit Deny/action/resource mismatch; unknown/duplicate fields, mapping/host/reference attestations, safe integer priorities, research privacy; concurrent stale publish/ABA, rollback revalidation, database and audit failure rollback; migration keeps legacy/policy/discovery snapshots byte-identical; no content or secrets in audit/errors.
- Use PGlite integration transactions and existing SSO/IAM readers, then focused HTTP framing/authentication tests. No live network inference.
- Run Node 22 focused tests, strict typecheck/Biome, `npm run check`, document/secret/schema and whitespace checks.

## Delivery

1. Record plan and shared design choices in Linear before coding.
2. Add failing API/persistence tests, then minimum validated transactional implementation and migration.
3. Add authenticated HTTP composition and red/green failure-path tests; update documents and evidence.
4. Push an issue-numbered PR as verified command-scoped `sjungwon03`, with authorized human DCO and `Assisted-by: Codex`; obtain independent `sjungwon03-ai` review through coordinator.
- Rollback: stop mounting the opt-in API; retain additive tables/history and the complete 001–015 migration bundle/manifest. Pre-015 binaries with shorter manifests fail the existing history guard against an upgraded database; disabling the endpoint must keep the upgraded runner. Revalidate and republish an older revision using current generation; never delete audit/history or rewrite legacy publication. A COMMIT acknowledgement failure is uncertain: read publication state before retry; do not claim mutation did not happen.
- Full checks and exact frozen head/review/CI evidence will be recorded before readiness. No merge/deploy is authorized.

## Verification record

- Initial test invocation was infrastructure-blocked by missing local dependencies, not a usable behavior RED. After `npm ci`, an explicit not-implemented service baseline produced six assertion failures (501 versus expected create/read/deny/publication behavior); the implementation made those cases green. The HTTP test was added before its handler existed.
- Genuine incremental RED/GREEN: retained caller operation mutation published with write-only permission (200 versus expected 400); copying the request before awaiting now preserves the authorized operation and original audit request ID. Approved but adapter-invalid OpenRouter slug accepted 201 versus expected 400; shared adapter validation now rejects it. Missing legacy direct registration returned 503 versus expected 400; import now rejects as invalid. A mismatched publication acknowledgement returned success versus expected unavailable; the transaction now checks generation and rolls back.
- Node 22.23.2 focused final command over owned configuration, migrations/sources, existing gateway runtime, audit-access storage and SSO binding storage: 55 tests passed, zero failures/skips. Strict TypeScript, changed-file Biome (zero diagnostics), document/link/contract/fixture-secret and whitespace checks passed.
- First aggregate `npm run check`: 10,655 tests, 10,649 passes, three obsolete latest-migration fixture failures and three platform skips, zero cancellations. Updated the gateway fixture's complete manifest, retained the historical audit-access 014 test against its historical subset, and extended the current SSO bundle expectation to 015; all affected cases pass in the focused final command.
- Final complete `PATH=/opt/homebrew/opt/node@22/bin:$PATH TMPDIR=/private/tmp npm run check` passed: 10,657 tests, 10,654 passes, three platform skips, zero failures/cancellations (126 seconds for tests). Strict typecheck, full Biome, planning/link/contract/fixture-secret scan and all six pinned OpenRouter schema gates passed. Only this verification-record text changed after the tested implementation; the document/whitespace gates were rerun.
- The already-pinned Zod 4.6.6 validator moved from development-only to runtime dependencies because production `--omit=dev` bundles must load this opt-in API. No package version was upgraded.
- Acceptance remains fixture API/SQL only; no UI/installed PostgreSQL/live-provider/operational acceptance, gateway activation, external prompt transmission or live Jev use occurred.
