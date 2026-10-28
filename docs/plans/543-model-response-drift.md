# Reviewed Model Response Nullable Marker Drift

## Issue and problem

- Issue: [#543](https://github.com/Theorvane/OpenGranter/issues/543); refs #116 and #7.
- The live comparison during #542 detected model-response pin v3 drift: seven nullable:true markers disappeared from selected DefaultParameters/TopProviderInfo fields. Their explicit type arrays still include null; the other five selected projections matched.
- Start from approved main dbed817 after PR #544 received approval on 3c5ee42f1152f9b5c7a5d04873dd2108810ea816 and all three successful checks and merged. Retain the reviewed HTTP fingerprint correction.

## Scope and expected behavior

- Fetch the fixed official public source again and independently review its selected projection before updating any pin. Accept only the documented seven removed markers if still current; investigate any additional selected difference rather than silently accepting it.
- Refresh only the model-response pin/provenance to version4 and its validator version gate. Reject previous versions, including correctly rehashed pins, while retaining nullable-marker changes as detectable structure.
- Preserve exact selected type arrays, required fields, other schemas, whole previous digest proofs and safe malformed/stale/drift/no-write CLI behavior. Preserve the other five pins byte-for-byte.
- No runtime HTTP, metadata publication/validation, provider/IAM/limits/audit/usage, dependency, migration or ledger changes. Source equality does not enable a runtime capability or certify full #116; unresolved Jev #7 stays open.

## Design

- Use existing fixed-host credential-free bounded fetch, structural projector and canonical SHA-256 functions. Keep structural nullable fields in normalization; the guard must detect future restoration, removal or changes rather than ignore them as editorial data.
- Independently assert all seven type/marker shapes, reconstruct the complete v3 projection by restoring those markers, and retain historical v2/v1 proofs. New provenance records the fresh source date/hash and selected projection digest.
- Update controlled CLI fixtures so marker drift remains real relative to v4, and test stale v3 rejection without making other pins stale. Existing multiple-drift, malformed/private, annotation/extension and no-write cases remain meaningful.
- Prefer a reviewed version transition over disabling nullability checks or blindly regenerating all pins. This is a reversible source-contract checkpoint with no new domain terms or architectural trade-off requiring an ADR.
- Update [model-response schema contract](../../contracts/model-response-schema.md), PRD/architecture/acceptance/compatibility and handoff. Record current live comparison results explicitly instead of claiming the previous mismatch was a runtime regression.

## TDD plan

1. Capture fresh source/diff outside Git and confirm the exact bounded change. Add independent v4 shape/prior-digest/stale-v3 assertions and run against the old pin/validator to record meaningful red.
2. Preserve unchanged other-pin bytes and test every affected nullable marker and type-array difference, safe errors and reconstructed historical projections.
3. Refresh only the reviewed model-response pin/version gate, update historical assertions and controlled marker/stale CLI fixtures, then run focused schema/CLI tests to green.
4. Run npm run check and a fresh six-selection fixed-source comparison. Verify runtime source/dependencies/migrations and other five pins have no diff.

## Delivery

1. Existing issue, fresh issue branch and this English plan before coding.
2. Independent review and red/green tests; narrow pin/version update.
3. Updated contracts/planning/handoff, source digests and full/live validation evidence.
4. Ready PR with plan and evidence, user author/committer, authorized DCO and Assisted-by trailers.
5. Merge only with exact-head approval and all required checks successful.

Risks/rollback: official schema can change again between review and a later run; do not refresh blindly. Selected structural equality does not prove complete graph/instance conformance. Revert the paired validator/pin/tests together if needed; no storage or runtime rollback is required.

## Review and verification evidence

- Fresh captured source matches exactly the seven documented marker removals; no other selected response change was accepted. The same captured source also matches the unchanged other five selected pins.
- Red before pin/validator changes: independent v4/provenance/shape/history suite ran 19 cases, with 10 expected failures and nine passes. The controlled restored-marker and stale-v3 CLI probes both failed under the old pin/gate, proving that neither can be a no-op under the new contract.
- Green: the independent 19 cases passed after the paired v4 refresh; five focused response/history/CLI suites passed all 182 cases. The complete 11-suite selected-schema/CLI regression passed all 711 cases with zero failures/cancellations.
- Fresh bounded credential-free live comparison passed all six selected subsets after reconciliation. The other five pin bytes, complete src tree, dependency files and migrations have no diff.
- Canonical source SHA-256: d211bd20aa7a7a7eac1c0f6deadf19417f8acd9a03ff51ec07ecda9194051e2e. Response projection SHA-256: 5d8b334d04ca90d1c4d1b587771b12f135a56c78dd9d532661dd60202d55b6af. Restored v3/v1 digest: 825714729401e81ab4a6196b7a8ed6b76d89a32c09869d02a18e812276ced87b. Historical v2 has the same projection as v4 but remains rejected by the current gate.
- Strict type checking, touched-file Biome and planning/link/secret checks passed. Full npm run check passed: 7,392 tests passed out of 7,393 total, zero failures/cancellations and one optional external PostgreSQL skip. Type checking, lint, planning/contracts/secret checks and all six offline integrity checks passed. Existing unrelated lint output remains 42 warnings and 65 informational diagnostics. Final document/diff checks passed after evidence updates. No live inference, provider credentials or runtime behavior change was used.
