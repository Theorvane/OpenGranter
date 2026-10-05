# Supported model-query schema drift plan

## Issue and problem

- Issue #458; release gate #116 remains open. The supported discovery queries have public HTTP/installed SDK cases but no source-pinned structural drift guard. The chat version-30 pin does not cover GET /models.
- Fresh official OpenAPI has GET /models (operationId getModels), five supported inline optional query parameters, and unrelated unsupported queries. The supported output modality token/default prose is not a structural enum/default.

## Scope and expected behavior

- Add a separate version-1 pin for GET /models identity and exactly offset, limit, output_modalities, supported_parameters and context parameter objects. Preserve location, explicit/omitted required status, schema, serialization fields and unknown structural extensions. Strip editorial annotations using existing schema normalization without stripping annotation-named property keys or literal defaults.
- Record fixed official URL, retrieval date, canonical source and projection SHA-256. Exact projection/pin maps reject missing/extra/malformed/stale/rehashed invalid data. Selected references are retained as structural strings; referenced targets are not traversed.
- Existing offline and explicit live commands validate both pins; fetch the fixed official source only once with existing credential-free redirect/time/body guards. Drift/failure has safe fixed output, nonzero exit, no downloaded content or pin writes. Validate both pins before live retrieval.
- Preserve the chat pin byte-for-byte and runtime gateway behavior, IAM, secrets, limits, usage and audit. No model calls or query capability/default changes.

## Design

- A narrow discovery projector reads the fixed operation and selected inline operation-level query parameters. Require one occurrence of each selected name, query location, a schema object, valid optional required boolean and no conflicting $ref/content. Reject references and supported-name path-level parameters: these unimplemented source shapes need explicit review rather than silently inventing merge/reference semantics.
- Capture whole selected parameter structure in an exact keyed map after annotation stripping. Parameter array order and unselected operation/path metadata/queries/endpoints stay outside the projection. Changes to operationId/document versions are selected.
- Share canonical structural normalization with the existing chat harness; keep its prior behavior and selections. Extend the CLI with separate fixed chat/discovery messages and a generic safe availability diagnostic.
- Alternative: extending the already large chat pin couples unrelated discovery and chat release versions; use separate bounded pins. No domain-model or costly irreversible decision changes. Response schemas, required unsupported query additions, inherited/ref targets, complete parameter inventory and instance/client certification remain unimplemented.
- Source: [official OpenAPI](https://openrouter.ai/openapi.json) and [model query reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties). Update [compatibility](../openrouter-compatibility.md), PRD, architecture, acceptance and [contract](../../contracts/model-query-schema.md).

## TDD plan

- First CLI integration case expects both offline integrity messages; the current chat-only CLI fails this assertion before implementation. Add meaningful structural/integrity cases before the new projector.
- Independent source fixture encodes actual five raw shapes rather than deriving all expected shapes from the pin. Verify nullability, bounds, explicit/default absence, serialization extensions, required/location/operation identity, selected-name deletion/duplication/malformed containers, schema refs, editorial-only changes, annotation-named properties and literal defaults.
- Reject stale versions, invalid provenance/digests and rehashed missing/extra/malformed exact maps. Safe CLI offline invalid arguments and live failure use controlled subprocesses without exposing source content. Existing fixed-host download failure/timeout/size/redirect/privacy tests remain shared.
- Implement the smallest projector/validator and command integration; focused tests, format, full npm run check and explicit fresh live drift check. Confirm chat pin Git diff is empty.

## Delivery

- Issue, branch, plan, CLI red evidence, structural tests, minimal code/pin, green checks, exact published diff review, both required CI jobs, sjungwon03-ai approval and sjungwon03 squash merge.
- Risks: structural equality does not prove runtime capability, semantic equivalence, prose-only defaults, unknown reference targets, source authenticity or full compatibility. Source digest is provenance, not a signature; source may legitimately drift and require manual review. Pin reads/comparison never mutate files.
- Report red/green evidence, full checks, fresh bounded drift, unchanged chat pin and remaining #116/#7 gates in the PR.

The discovery normalizer preserves complete x-* extension literal data, including annotation-named keys inside extension objects. The shared normalizer keeps its legacy mode for all chat callers, so chat canonical projections and runtime behavior remain unchanged. A failing regression initially showed extension description values collapsing to the same empty object; the discovery-only normalization mode preserves their differences.

## Verification evidence

The compatibility harness now detects official structural changes in the five implemented model discovery query objects (offset, limit, output_modalities, supported_parameters, context) using a separate version-1 GET /models (operationId getModels) pin. It captures actual optionality/nullability/bounds/defaults and parameter serialization/extensions without inventing prose-only modality defaults/enums or local runtime limits. Runtime discovery, authorization, provider calls, limits, secrets, audit and accounting remain unchanged; the chat version-30 pin is byte-identical.

Both offline and explicit live commands validate the exact pins before one credential-free fixed-host bounded retrieval, report each selected subset separately and never write pins. Missing/duplicate/malformed selected source parameters, unsupported inherited/reference shapes and stale/rehashed invalid envelopes/maps reject safely. Editorial changes and parameter order are ignored; literal defaults, annotation-named properties and complete x-* extension data remain structural. Shared chat normalization retains its legacy behavior.

Red evidence: the first offline CLI case failed because the old command only reported chat-pin integrity. A second focused regression failed because extension objects with different description values collapsed to the same empty object. Both now pass. All 47 new structural/integrity/isolated-CLI cases and 317 focused discovery/chat/probability schema cases pass. CLI cases verify one download, chat-only/model-only/both drift, safe transport/malformed-source failure, invalid pin rejection before network or success output, and byte-identical pins. Existing fixed-host redirect/size/deadline/privacy tests remain green. Full npm run check passes 5,150 tests with one existing PostgreSQL skip. Fresh compatibility:drift confirms both selected projections unchanged.

Source URL https://openrouter.ai/openapi.json, retrieved 2026-10-05; canonical source SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; model-query projection SHA-256 daa5d309dfc66e8b404f50fb06a64ab4d7e244de8a7f68f78f943a9f94ee4c7a. Independent fixture shapes and official source review agree. README and product/architecture/acceptance/compatibility/contract documentation describe the bounded guard.

Material limits: partial structural equality is not runtime instance/response validation, source authenticity, prose-semantic tracking or live capability certification. Referenced targets, inherited/unselected query structure, newly required unsupported parameters, query extensions, metadata provisioning and full external-client workflows remain open. No source or pin is updated automatically. Full #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 5150 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
