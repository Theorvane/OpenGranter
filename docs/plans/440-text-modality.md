# Explicit text output modality

## Issue and problem

Issue: [#440](https://github.com/Theorvane/OpenGranter/issues/440), continuing #116 after #438. Both public chat bases reject modalities even when a caller requests only the already supported text output.

## Scope and expected behavior

Accept exact modalities=["text"] on managed OpenAI/delegated OpenRouter nonstream and text/refusal/function streams. Null/omission omits the upstream field without injecting a default. Null normalization is an explicit native OpenAI-compatible local extension: OpenRouter's source/SDK is nonnullable. Reject non-array, empty, sparse, duplicate, multi-item, unknown/audio/image and extra enumerable array members before routes. Exact singleton/cardinality and extra-member restrictions are local, not source constraints. Capture root, length and own index zero once, freeze the selected tuple before credentials and do not retain caller objects.

Native Anthropic/Gemini supplied selectors reject before secrets without native responseModalities/default translation; null/omission preserves existing native behavior. Preserve all independent optional controls and existing prediction/tool restrictions. Model capability remains administrator/provider controlled; accepting a text selector enables no richer output or registration. All approved model/final-provider/host scope, authenticated IAM/Deny/limits, private operational records/errors, required audit/usage, missing usage, cancellation and safe possibly-billed failures remain shared. No synthetic field echoes or usage derivation.

Out of scope: audio/image/rich input or output, empty/duplicate-array semantics, native Anthropic/Gemini modality mapping, live model guarantees, discovery changes, other endpoints, full #116 and unresolved #7.

## Design

Add a pure text-only modality snapshot helper at gateway/native/delegated request preparation boundaries and forward only to OpenAI/OpenRouter bodies. Immutable capture avoids asynchronous caller mutation. Extend the raw source projection with the modalities field only and version-27 pin; removing that selection must reproduce version 26 canonically. Retain source item enum text/image/audio, unknown-values extension, nonnullable array and absence of minimum/maximum/uniqueness/default; do not encode local restrictions into source provenance.

Repository grill-with-docs/grilling/domain-modeling research delegated read-only facts to verify [OpenRouter schema](https://openrouter.ai/openapi.json), [OpenRouter create](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion), [OpenAI create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [OpenAI prediction guide](https://developers.openai.com/api/docs/guides/predicted-outputs) and installed SDKs. Native Gemini's documented responseModalities set and absent Anthropic selector do not require adding a native mapping in this bounded scope. No new domain term or costly architecture decision; repeated implementation authorization covers this continuation.

Update docs/PRD.md, docs/architecture.md, docs/acceptance.md, docs/openrouter-compatibility.md, contracts/text-modality.md and the schema drift contract.

## TDD plan

First meaningful tests submit ["text"] through public HTTP/adapter/actual SDK boundaries and expect exact forwarding; current unknown-field rejection/dropped selection is the red. Cover both bases/routes, supported output modes/streaming, null/omission, malformed/unavailable selectors, adversarial single/throwing capture and await mutation, native rejection, independent metadata/cache/prediction/history, auth/model/provider Deny/limits, required persistence, missing usage, safe opened failures and body cancellation. Add raw field schema drift cases for type/enum/extensions/cardinality/uniqueness/default, missing/malformed source fields and stale/rehashed pin maps.

After observed red implement minimum validation/capture/projection, format, run focused regressions, full npm run check and fixed-host compatibility:drift. Actual SDKs use approved controlled upstream fixtures; no live inference certification.

## Delivery

Issue/new branch/English plan precede coding. PR links this plan/contract and records red/green, source/projection/removal equality, SDK limits and remaining gaps. Exact-head sjungwon03-ai approval plus both CI check jobs precede sjungwon03 squash merge and clean main synchronization. Rollback reverts optional selector/projector/pin together; no migration/dependency/workflow authority change.

## Verification evidence

Both chat bases previously rejected modalities even for text-only output. They now capture/freeze exact ['text'] before credentials and preserve it on managed OpenAI/delegated OpenRouter nonstream and text/refusal/function streams. Null/omission adds no default; null is an explicit native OpenAI-compatible local extension against the nonnullable OpenRouter schema/SDK. Non-array/empty/sparse/duplicate/mixed/audio/image/unknown or extra enumerable members reject before routes. Native Anthropic/Gemini supplied selectors reject before secrets without native translation; omission/null retain defaults. No richer output or eligibility change.

Approved model/final-provider/host scope, authenticated IAM/Deny/limits, secret references, private operational projection/errors, required audit/ledger before final frames, missing usage and possibly-billed failures/cancellation remain shared. Independent cache/client controls, correlated function history and prediction restrictions retain their existing behavior. Request fields are never echoed synthetically or used to derive usage; actual upstream text/probability content is valid client output.

- Red: 102 of 291 public request/adapter/SDK/schema cases failed before implementation, reproducing rejection/dropped text selection and absent structural drift selection.
- Green: 471 focused text/cache/prediction/SDK/schema regressions pass; 113 new cases cover both bases/routes/modes/streams, nullable/default behavior, unavailable/malformed selectors, single/throwing root/length/index capture and await mutation, native rejection/defaults, all authorization/persistence gates, missing usage, opened failures, cancellation, independent controls/history and prediction restrictions. Actual installed OpenAI 7.23.0 and OpenRouter 1.4.18 complete 48 controlled gateway socket requests. SDK arrays are copied into mutable request types; the existing developer-message fixture now satisfies both gateway and SDK types directly without unsafe whole-request assertions. Production readonly capture remains strict.
- Version 27 adds only modalities (32 fields/19 request-history definitions). Removing the field reproduces version 26 canonically. Fresh official source SHA-256: 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; projection: 9a05828adb4babe323c3476b790b92aa56b3b3d09cc16a36c39915544a004150. Retain source text/image/audio enum and unknown-values extension with no invented cardinality/uniqueness/default. Structural drift and missing/malformed/stale/rehashed maps are guarded; fixed-host compatibility:drift passes.

Audio/image/rich workflows, broader array semantics, native mappings, live model support, complete #116 and unresolved #7 remain open. No storage/dependency/usage algorithm/workflow authority change.


Full npm run check passes strict types, lint, 4184 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
