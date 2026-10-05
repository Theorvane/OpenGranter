# Model discovery response schema drift plan

## Issue and problem

- Issue #462; release gate #116 and unresolved #7 remain open. Chat and eight model-query selections have structural pins, but model-list response metadata has no official response drift guard.
- Fresh official GET /models (operationId getModels) HTTP 200 application/json references ModelsListResponse and a finite closure of 21 component schemas. Nested changes can break clients without changing the response reference.

## Scope and expected behavior

- Add a separate version-1 pin for operation/document identity, status/media identity, complete response schema and exactly the 21 currently reachable component definitions. Capture entire definitions, including currently unimplemented optional metadata, without enabling runtime fields.
- Preserve references, required/nullable shapes, bounds, enums, defaults, formats, structural extensions and annotation-named properties/literal data. Ignore editorial annotations and unrelated operations/status/media/components. References to future targets remain structural strings; do not fetch or recursively expand new targets automatically.
- All three pins validate before a single fixed-host, credential-free bounded live fetch. Independent diagnostics identify drift; malformed data withholds success output and fails safely. Offline checks require no network; neither mode writes pins.
- Chat version30 and query version2 pins remain byte-identical. Gateway responses, IAM, secret resolution, limits, audit and usage behavior are unchanged.

## Design

- Use a narrow TypeScript projector/validator sharing canonical structural normalization and fixed-host fetch safeguards. Select ModelsListResponse, ModelsListResponseData, Model, ModelAliasTarget, ModelArchitecture, InputModality, InstructType, OutputModality, ModelGroup, ModelBenchmarks, AABenchmarkEntry, DABenchmarkEntry, DefaultParameters, ModelLinks, PerRequestLimits, PublicPricing, PricingOverride, ModelReasoning, ReasoningEffort, Parameter and TopProviderInfo.
- Validate exact projection/pin maps, nonempty schema objects, fixed pin identity, date/digests and canonical normalized structures. Source schema/reference changes compare unequal; missing or malformed selected containers fail for review. The pin is a reviewed baseline rather than an instance validator or signature.
- A separate response pin avoids coupling request/query version changes. Fixed selections make review scope explicit; automatic remote reference traversal would expand trusted input and hide decisions. No glossary or qualifying irreversible domain decision changes.
- Source: [official OpenAPI](https://openrouter.ai/openapi.json) and [model reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties). Update PRD, architecture, acceptance, compatibility, README and [contract](../../contracts/model-response-schema.md).
- Open scope: new reference targets, other endpoints/status/media, runtime instance validation, rich metadata provisioning and full client/live-provider certification remain under #116.

## TDD plan

- First public CLI test expects response-pin integrity beside existing messages; current command fails by omitting it. Record the failure before implementation.
- Independent small official-source fixture verifies operation/container/ref identity and nested properties, requirements, nullability, enums, formats, extensions, defaults and annotation-name handling. Cover every selected definition deletion/malformed shape and stale/rehashed invalid exact maps with fixed errors.
- Controlled subprocess tests cover offline success, one-download live success, independent/all drift, invalid pins before network, malformed response source without success output, privacy and byte-identical pins. Existing fetch redirect/body/deadline/cancellation cases remain shared.
- Implement the smallest guard/pin/CLI integration; focused tests, npm run format, full npm run check and fresh compatibility:drift. Verify prior pins have no diff.

## Delivery

- Issue, new branch, plan, red evidence, structural/CLI tests, minimal implementation, green validation, published diff review, both required CI jobs, sjungwon03-ai exact-head approval and sjungwon03 squash merge.
- Risks: source equality cannot prove semantic prose, runtime instances, live capability or source authenticity; source digests are provenance only. Entire definitions include unsupported fields, but structural selection grants no capability. New targets require a follow-up issue. Roll back the guard/pin together if needed; never silently refresh a pin.
- Report red/green evidence, canonical provenance and unchanged earlier pins; retain material #116/#7 limitations.

## Verification evidence

Model discovery responses previously had no independent source drift gate. Add a separate version-1 GET /models (getModels) HTTP200 application/json pin selecting its response schema and all 21 definitions reachable in the reviewed official source. Nested required/nullability/enums/references/defaults/formats/bounds/extensions now detect structural drift even with unchanged parent references; editorial annotations and unrelated endpoints/status/media/headers/components remain excluded. Full definitions include optional metadata that remains unimplemented at runtime. New reference targets are not fetched or automatically expanded.

The compatibility command validates chat/query/response pins before one fixed-host credential-free bounded live download, computes all comparisons before success output, reports independent content-free diagnostics, and never writes pins. Preserve byte-identical chat version30 and query version2 pins and all runtime gateway/IAM/audit/secrets/limits/usage behavior. README, PRD, architecture, acceptance and compatibility documents describe the guard and its limits.

Red evidence: the public offline CLI regression failed because the old command omitted response-pin integrity. Green evidence: 392 focused schema cases pass, including 61 new response structural/integrity cases and four new controlled CLI cases. Tests cover each selected definition's nested drift/deletion/malformed shape, independent and simultaneous subset drift, exact pin maps/provenance, annotation-named literals/extensions, safe source/transport failures, invalid pins before network, one download and byte-identical pins. Existing fixed-host timeout/size/redirect/privacy guards remain green. Full npm run check passes 5,294 tests with one existing real PostgreSQL skip; fresh compatibility:drift reports all three subsets unchanged.

Fresh official source https://openrouter.ai/openapi.json, retrieved2026-10-06, canonical source SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; response projection SHA-256 825714729401e81ab4a6196b7a8ed6b76d89a32c09869d02a18e812276ced87b. Independently enumerated reference closure exactly matches the 21 pinned definitions. Synthetic independent fixtures test projection/drift behavior; explicit source shape assertions and fresh source equality verify the reviewed baseline.

Material limits: structural equality does not validate runtime instances or complete JSON Schema semantics, authenticate source provenance, track prose semantics, provision metadata, enable optional fields or certify live capabilities. New reference targets and other endpoints/status/media/headers remain outside detection. Full compatibility #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 5294 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
