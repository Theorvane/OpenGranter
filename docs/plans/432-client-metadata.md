# Bounded client request metadata

## Issue and problem

Issue: [#432](https://github.com/Theorvane/OpenGranter/issues/432), continuing #116 after #430. Both chat bases reject compatible metadata dictionaries before request preparation.

## Scope and expected behavior

Accept optional non-nullable string dictionaries on managed OpenAI/delegated OpenRouter nonstream/stream text/refusal/function calls. Enforce the documented maximum of 16 pairs, 64-character keys and 512-character values; use a documented local Unicode-code-point interpretation of character limits (upstream counting is unspecified), preserve exact whitespace/case/empty strings and arbitrary JSON keys. Snapshot and freeze once before asynchronous credentials. Malformed values reject before route work. Omission preserves defaults; supplied empty maps remain present. Native Anthropic/Gemini supplied maps reject before secrets because user_id and restricted labels are inequivalent. Null remains unsupported as in OpenRouter; OpenAI nullable extension remains a gap.

Tags never grant IAM authority, alter authenticated attribution, select destinations or change limits/usage/audit rules. Do not echo/store them in operational records/errors or automatically enable local content auditing or upstream storage. OpenRouter broadcast custom data uses its separate trace field; never translate metadata to trace or claim these tags are broadcast. Forwarding does not certify provider storage/querying/privacy. Existing fixed hosts, required persistence before final delivery, cancellation and missing usage stay shared. Out of scope: tier routing, native mappings, storage/trace retrieval, live certification, broader endpoints, full #116 and unresolved #7.

## Design

Add a pure bounded dictionary capture helper at gateway and both prepared provider boundaries; preserve normal/null prototypes and own enumerable string entries via Object.fromEntries, including __proto__/constructor keys without prototype mutation. Reject non-record objects, arrays, null and non-string values; getters are read once and throwing accessors produce fixed existing errors. Keep approved model/provider scope independent from arbitrary tag names. No new domain concept, ADR or unresolved architecture default.

Repository grilling delegates primary-source factual research: [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [OpenRouter observability](https://openrouter.ai/docs/guides/features/broadcast/overview), [OpenAI create](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), installed SDKs and native provider docs. Published 16/64/512 bounds are prose, not structural OpenRouter constraints; do not invent them in the pin.

Version 23 adds only metadata to 28 selected request fields; verify all prior selections by canonical removal equality and fresh source/projection digests. Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [contract](../../contracts/client-metadata.md) and source drift contract.

## TDD plan

First public HTTP and adapter cases expect preserved dictionaries; red reproduces unknown-field rejection and dropped fields. Cover bounds at/beyond limits, Unicode code points, arbitrary keys, empty/null/omitted maps, malformed values and prototypes, mutable/throwing top-level and nested getters, immutable capture across credentials, native pre-secret rejection, both bases, actual SDK sockets, text/refusal/functions and stream modes. Verify auth, implicit/model/provider Deny, limits, selection/outcome audit and ledger failure, missing usage, sanitized transport failure and independence from user/cache fields. Source tests cover nested additionalProperties, type/required/default/bounds/extensions, annotation-only equivalence, malformed/missing targets and stale/rehashed invalid pins.

Implement the smallest capture/forwarding change after recording red. Format, focused tests, full npm run check and explicit fixed-host compatibility:drift.

## Delivery

Issue/new branch/plan precede code. PR records red/green, source provenance, SDK fixture limits and remaining gaps. sjungwon03-ai exact-head review and both CI jobs precede sjungwon03 squash merge and clean main synchronization. Rollback removes optional support and restores pin/projector together; no storage migration or new dependency.

## Reviewed provenance

Fresh fixed-host source on 2026-10-05 retains canonical SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458. Version-23 projection SHA-256 is 02b10bb1c040cd9141a520c0622122f70c684cfd8d9c92f4433c4675f4a14499. Removing only metadata reproduces version 22 canonically; every prior field/definition/map remains unchanged. Character counting is explicitly a local code-point interpretation, not a verified upstream promise. Broadcast trace remains a separate unsupported request field.

## Verification evidence

Compatible clients previously received an unknown-field error for metadata. Both chat bases now capture and freeze bounded optional non-nullable string dictionaries before credentials and preserve exact own entries on managed OpenAI/delegated OpenRouter nonstream/stream text, refusal and function requests. Empty maps/strings, Unicode, whitespace and arbitrary JSON keys survive without prototype mutation. Enforce published 16/64/512 bounds with an explicit local Unicode-code-point interpretation; upstream counting remains unspecified. Invalid/null/beyond-bound input fails before routes, and native Anthropic/Gemini supplied maps fail before secrets without inequivalent user_id/labels mappings.

Caller tags, user attribution and cache preferences remain independent. Tags cannot override authenticated principal/credential/policy identities, approved provider/model/host scope, IAM/Deny, limits or ledger/audit attribution; they never supply usage, enter operational records/errors or echo into responses. No store, trace, broadcast or content-audit behavior is enabled. Required persistence, missing usage, cancellation and safe possibly-billed failures remain shared.

- Red: the public metadata/SDK/source tests failed 93 of 231 cases before implementation, reproducing unknown-field rejection, dropped fields and missing structural selection.
- Green: 589 focused metadata, earlier user/cache, installed SDK and source regression tests pass. Added 94 cases covering bounds, private tags, arbitrary/prototype-sensitive keys, mutable/throwing root/nested getters, native defaults/rejection, auth/Deny/limits, selection/persistence failures, missing usage and safe opened failures. Existing fixture probability content is allowed in response frames; tag-specific values remain excluded.
- Actual installed OpenAI 7.23.0 and OpenRouter 1.4.18 complete 48 fixture-backed gateway socket requests across two bases/routes, three modes and stream/nonstream; no live provider certification.
- Version 23 adds exactly metadata to 28 selected fields. Removing it reproduces version 22 canonically. Fresh official source SHA-256 remains 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458; projection SHA-256 is 02b10bb1c040cd9141a520c0622122f70c684cfd8d9c92f4433c4675f4a14499. Published prose bounds are not fabricated structural constraints; nested type/required/default/bounds/extensions and stale/rehashed invalid maps are guarded. Explicit fixed-host compatibility:drift passes.

OpenAI nullable metadata, native mappings, upstream storage/query/counting semantics, tier routing, full #116 and unresolved #7 remain open. No storage migration, dependency, destination registration, response/accounting rule or workflow-authority change.


Full npm run check passes strict types, lint, 3741 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
