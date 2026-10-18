# Expose IAM-filtered single model discovery

## Issue and problem

- Issue: [#514](https://github.com/Theorvane/OpenGranter/issues/514), part of #116.
- Installed OpenRouter models.get uses GET /api/v1/model/{author}/{slug}; the gateway currently returns 404 for all published models.

## Scope and expected behavior

- Return exactly {data: existing rich model projection} for an exact administrator-published alias author/slug, including explicitly published colon variants and safe Unicode identifiers. Do not resolve canonical_slug/alias_target or infer an upstream model/URL from the path.
- Reuse authentication, full hidden-catalog metadata capture/validation, enabled model/final-provider IAM and required audit. Unknown/disabled/inaccessible aliases return identical private 404 responses. Reload current catalog/policy each call. A visible target lacking rich metadata returns safe 503 rather than an incomplete SDK model.
- Recognize only GET under the compatible singular /model/ prefix. Decode two nonempty segments once, bound author to128/slug to256 UTF-16 units, reject dot segments, whitespace/control characters and decoded slash/backslash/percent/question/hash. Reject malformed recognized paths or nonempty queries after authentication before catalog access. Unsupported methods/legacy/plural paths remain404. No request body reads; recognized lookup responses use no-store, including errors.
- Add model-read audit with only count0/1 and model-read-unavailable with no details; retain attribution and persist through the existing audit/history projector. Never include requested names, raw paths, metadata, prompt/response content or credentials. No migration, routing, inference, limits, secrets or usage calls.

## Design

- Add a small pure path parser, then extend the shared discovery block without a separate catalog/IAM implementation. Use the existing captured rich row projection and build it before awaiting audit. Required model-read audit precedes both200 and404. Full catalog/required-metadata failures record model-read-unavailable before503.
- Keep the response root and existing model fields distinct from routing authority. A basic alias stays available through existing listing, but cannot produce an incomplete rich result through this endpoint. Administrative metadata provisioning remains separate work.
- Source: [official get reference](https://openrouter.ai/docs/api/api-reference/models/get-a-model-by-its-slug) and [OpenAPI](https://openrouter.ai/openapi.json), inspected2026-10-18. Source operation getModel references ModelResponse and the existing Model schema. Local segment bounds, IAM/proxy-token visibility and exact published-alias matching remain explicit restrictions.
- Update [contract](../../contracts/single-model-discovery.md), PRD, architecture, acceptance and compatibility. Existing four pins stay unchanged; this operation/path/root envelope is not yet structurally monitored and needs explicit follow-up before claiming that coverage. Full #116/#7 remain open. No glossary/ADR change is necessary.

## TDD plan

- Write raw/installed OpenRouter SDK and audit projection/history cases first; record expected unsupported-route404 and unknown-audit-kind failures.
- Verify success on both route kinds, rich fields/relative links, explicit variants/Unicode, exact alias only, model/provider/implicit Deny, disabled/unknown equality, fresh state and multiple candidates without duplicates.
- Cover auth before query/path/catalog/body, malformed/oversized/double-encoded segments, unsupported methods/bases, hidden malformed catalog, missing required metadata, catalog/audit failures and immutable output despite audit mutation. Verify no-store and no sensitive operational data.
- Verify count0/1 only, malformed audit inputs, safe append faults and migrated principal-scoped audit/history. Run focused discovery/audit/SDK regressions, unchanged pin checks and npm run check.

## Delivery

- Ready plan-linked PR with red/green/full-gate evidence, authorized sjungwon03 identity, Assisted-by and DCO. Require exact-head approval and CI before merge.
- Limits: metadata may be stale; richer alias resolution, endpoint inventory, structural selection for the new operation and full client certification remain open. Rollback removes the new route/parser/audit kinds together.

## Verification evidence

- Red: the first raw/installed OpenRouter SDK/audit suite ran15 cases with14 expected failures and one existing unsupported-method pass. Supported requests returned404, and the audit projector rejected the new kinds before implementation.
- Green: the expanded eleven discovery/count/price/audit/SDK suites passed all143 cases. Strict types/lint passed after using a readonly method/path tuple in a test; compiler settings and lint rules remain enabled. Safe Unicode and inclusive decoded segment bounds are verified through the public handler, plus actual SDK variant/Unicode sockets.
- All four source pins have no diff from main. Follow-up [#515](https://github.com/Theorvane/OpenGranter/issues/515) explicitly tracks the unselected operation/path/root response. This feature does not claim that structural coverage or complete compatibility.
- Full `env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed:6,894 cases,6,893 passed, one optional external PostgreSQL skip, zero failures/cancellations. Strict types, lint, planning/link/contract/fixture-secret checks and all four offline pin checks passed. Evidence: /tmp/opengranter-514-check.log. CLAUDE.md remains a symlink and migrations remain unchanged.
