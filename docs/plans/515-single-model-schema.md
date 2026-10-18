# Track single model discovery schema drift

## Issue and problem

- Issue: [#515](https://github.com/Theorvane/OpenGranter/issues/515), following runtime #514, part of #116.
- Existing four pins do not select getModel path/operation/parameters or ModelResponse. Monitoring Model through listing does not cover its separate lookup envelope.

## Scope and expected behavior

- Add a separate version1 fifth pin for GET /model/{author}/{slug}, OpenAPI/document identity, complete author/slug path parameter objects, HTTP200 application/json root schema, complete ModelResponse and Model definitions.
- Preserve previous four pins byte-for-byte. The existing model-response pin continues to monitor referenced metadata bodies; the new pin selects the common full Model object and lookup root without duplicating the entire graph. New/unselected target bodies are not automatically traversed or fetched.
- Validate all five pins before one optional fixed official bounded credential-free download. Compute all comparisons before any success output; report each independently, return nonzero on drift/invalid/unavailable data and never write pins. No runtime IAM, alias resolution, catalog, audit, usage, limit, secret or model-call change.

## Design

- Reuse shared structural normalization/canonical hashing/fixed-host fetch. Exact projection maps contain only the two path parameters and two definitions. Required path parameters must be explicit true; reject selected names inherited from path-level parameters rather than silently resolving overrides. Retain unrelated inherited headers without following references.
- Require exact pin envelope/maps, version1, fixed URL/operation/root reference, valid ISO date and canonical source/projection digests. Selected nonempty schemas and malformed containers fail with fixed content-free errors. Structural source differences (including future optionality/location changes) must be detected by comparison or fail safely, never silently ignored.
- Source: [official OpenAPI](https://openrouter.ai/openapi.json), inspected2026-10-18. Runtime segment bounds, Unicode/encoding rules, exact publication policy and no-store behavior stay separate from the two unconstrained source string parameters.
- Update [contract](../../contracts/single-model-schema.md), runtime contract, PRD/architecture/acceptance and compatibility. Full semantic validation, broad alias resolution, endpoint inventory, unselected response status/media/headers and full #116/#7 remain open. This applies the existing bounded-selection design; no domain/ADR change is needed.

## TDD plan

- First write independent projection/shape/drift tests importing the new boundary and an offline CLI fifth-result expectation; record missing-module/result failures before implementation.
- Cover both path parameters (required/location/type/default/bounds/serialization/extensions), root reference, ModelResponse data reference/required list and whole Model changes with unchanged root references. Verify existing pin Model equality and referenced metadata coverage through the existing response guard.
- Test missing/duplicate/inherited/malformed selected entries and responses/definitions, excess depth/nonfinite data, old/rehashed invalid envelope/maps and safe errors. Preserve editorial normalization while retaining annotation-named properties and literal/extension data.
- Extend controlled CLI source/fixture copies to five pins. Test single-only parameter/root/model drift, shared Model drift, metadata-only response drift, simultaneous drift, stale/invalid fifth pin before fetch and malformed fifth source without success output. Assert one credential-free fixed-host download and unchanged bytes for every case.
- Run focused schema/CLI/runtime regressions, fresh live five-pin comparison and npm run check; update validation evidence before a ready PR.

## Delivery

- Authorized sjungwon03 author/committer, Assisted-by and DCO, plan-linked ready PR, exact-head approval and CI required before merge.
- Risks: structural guards are not JSON Schema semantic validation, source signatures or live provider certification. New target bodies need explicit selection. Rollback removes the fifth guard/CLI reporting together while preserving existing pins and runtime.

## Verification evidence

- Red: the new boundary test failed with the expected missing-module error before implementation. The isolated offline CLI case failed because the fifth integrity result was absent. Evidence: /tmp/opengranter-515-red.log and /tmp/opengranter-515-cli-red.log.
- Green: nine schema/CLI/single-model-runtime/audit suites passed all555 cases. Tests cover independent lookup shapes, shared full Model equality, single-only/shared/metadata-only/all-five drift, safe fifth-pin/source failures and unchanged pin bytes. A fixture initially treated an empty optional inherited parameter list as invalid; it now tests that valid empty list positively and uses a malformed entry for the failure case. Strict types remain enabled; malformed test inputs use Reflect rather than weakening their inferred types.
- Fresh fixed-host live comparison passes all five subsets. Canonical source SHA-256 e14bcc1e02453bff8807cc79d03170ce7d229a9d0836e253ff49b764b8aa811d; single-model projection SHA-256 de4f732c32b47607cd875b2dd5d4eb000365b232a9d855ee5ae5f91106689d8c. Previous four pin files have no diff from main. Documentation/links/contracts/fixture-secret checks pass; full gate evidence is recorded before delivery.
- Full `env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed:6,937 cases,6,936 passed, one optional external PostgreSQL skip, zero failures/cancellations. Strict types, lint, planning/link/contract/fixture-secret checks and all five offline pin checks passed. Evidence: /tmp/opengranter-515-check.log. No migration, runtime service, previous pin or instruction symlink change.
