# Review current OpenRouter structural drift

## Issue and problem

- Issue: [#526](https://github.com/Theorvane/OpenGranter/issues/526), part of #116.
- A fresh official comparison on2026-10-25 reports request/model-query/model-response drift, while count/singular-model selections remain unchanged. Compare selected projections independently before refreshing any provenance.

## Scope and expected behavior

- Advance request pin32 to33 for optional PromptCacheBreakpoint.ttl:string|null, query pin4 to5 for removal of offset's nullable:false marker, and model-response pin2 to3 for restoration of seven nullable:true markers on DefaultParameters/TopProviderInfo.
- Retain every existing selected field/definition/map and all explicit nullable type arrays. Count/single-model pins stay byte-identical. All five CLI results, one bounded credential-free fetch, atomic failure output and no-write behavior remain unchanged.
- No runtime API/parser/provider/IAM/limit/secret/audit/usage changes. Structural tracking does not enable breakpoint TTL or relax any runtime restriction.

## Design

- Use the existing structural normalization, selected projections and fixed official source. Record fresh canonical source/projection SHA-256 provenance after review; do not infer runtime support from optional source additions.
- Add independent expected field/type/optionality/marker assertions and reconstruct the complete previous32/4/2 digests. Preserve older historical digest tests by explicitly reversing the new deltas before reversing their original changes.
- Extend controlled CLI fixtures for breakpoint TTL, offset and restored-marker drift, stale prior versions and safe no-write diagnostics. Existing unsupported references/instance semantics remain outside coverage.
- Update schema contracts, PRD, architecture, acceptance, compatibility and handoff. No domain or architectural decision change requires glossary/ADR edits.
- Adding a user-operation source guard remains follow-up work; existing drift is resolved first. Complete #116 and Jev #7 remain open.

## TDD plan

- First run independent expected pin versions/shapes, stale-version rejection and prior-digest tests against the old validators/pins; record expected red failures.
- Verify each changed schema property's type/optionality and marker presence/absence triggers drift, while annotations do not. Preserve exact safe errors and pin byte comparisons through the CLI harness.
- Refresh only the three paired versions/projections/provenance, update current shape assertions and historical reconstructions, then run focused schema/CLI suites, fresh five-pin live comparison, offline integrity and npm run check.

## Delivery

- Use the new issue branch, authorized author/committer, DCO and Assisted-by. Open a ready plan-linked PR requiring exact-head approval and successful checks.
- Risk: selected-source equality does not prove complete schema/instance or client/runtime behavior. Roll back each paired version/validator/pin together if needed; no migration is involved.
- Record source/digest and red/green/live/full validation evidence before delivery. PR #525 is merged as87512ac; the new user-list operation remains outside these five structural selections.

## Review and verification evidence

- Baseline fresh live comparison correctly reported request/query/response drift and count/single equality. Independent selected-projection diff isolated exactly the TTL addition, one removed offset marker and seven restored response markers; no other selected changes were accepted.
- Red: the new independent suite ran 16 cases against old pins/validators: 13 expected failures and three passes. Evidence: /tmp/opengranter-526-red.log.
- Green: nine focused reviewed/request/query/response/probability/CLI/count/singular schema suites passed all 613 cases, including complete prior32/4/2 digests and earlier migration proofs. Evidence: /tmp/opengranter-526-focused.log. Strict types passed without configuration changes.
- Fresh bounded credential-free fixed-host live comparison passed all five selected subsets after refresh. Evidence: /tmp/opengranter-526-live.log. Count/single pin bytes, dependency files, migrations and the complete src tree have no diff.
- Canonical source SHA-256: d1bdaad4b513143f1b122de5e0c50ce06469e7a669efef0c2f3b9d40829ac1ee. New request/query/response projection SHA-256 values: 2603ec309b22e2b88d4f964b70b021b4c759eb564111fcc6b347876a57192f65, 722ae52d1d5ffcc09717be6012ef6110279c470808bc4a468085c7e021d8f11b and 825714729401e81ab4a6196b7a8ed6b76d89a32c09869d02a18e812276ced87b. Runtime marker validation still rejects breakpoint properties other than mode; no feature was enabled by the source addition.
- Full `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 7,017 cases, 7,016 passed, one optional external PostgreSQL skip, zero failures/cancellations. Every original test/deadline remained enabled. Types, lint, planning/link/contract/fixture-secret checks and all five offline integrity results passed. Existing lint warnings/infos were not modified. Evidence: /tmp/opengranter-526-check.log.
