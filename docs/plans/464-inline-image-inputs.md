# Inline user image input plan

## Issue and problem

- Issue #464, continuing release gate #116. External vision clients cannot send images: public normalization rejects image_url and internal histories only admit strings or marked text arrays.
- Official ChatContentImage supports image_url.url and optional detail; installed OpenAI supports auto/low/high and OpenRouter additionally original. This first portable subset accepts canonical inline data only.

## Scope and expected behavior

- User content arrays may mix exact plain text and image_url parts, preserving order, empty text and image-only requests. Images accept data:image/png|jpeg|webp|gif;base64,<canonical nonempty payload> and optional auto/low/high. Reject remote URLs, original, null/unknown fields, non-user roles and mixed cache markers.
- Local limits: at most128 parts per image-bearing message; each complete image URL at most524288 UTF-16 units; all complete image URLs across a history at most786432 units. The existing1MiB HTTP body limit still applies. Canonical base64 validation is not image decoding, MIME verification or live model certification.
- Direct OpenAI and delegated OpenRouter preserve frozen payloads for nonstream and existing text/refusal/function streams through both bases. Native Anthropic/Gemini reject images before secrets. Cached text behavior remains unchanged; any image history with request/block/tool cache controls, breakpoints or prompt_cache_options rejects explicitly.
- No URL fetch, file read, arbitrary upstream host, image transformation, token estimate or content logging. Model and final-provider IAM/Deny, limits, required audit/usage, missing usage and possibly-billed errors remain shared.
- Text-prompt Jev disclosure rejects an image history before selector secrets instead of dropping images or disclosing base64; metadata-only Jev selection remains unchanged. No new Jev disclosure policy is settled.

## Design

- Add immutable bounded inline image-part capture and widen internal content-part types. Public normalization retains image-bearing arrays; shared snapshots allow them only on user messages and enforce total budget. Keep one-read primitive captures and fixed array positions through mutations.
- Generalize the existing strict marked-text array snapshot only behind an explicit user-image option, retaining its default restriction. Shared cache helpers discriminate text/image and reject unsupported combinations. Direct validation and exported native converters explicitly close unsupported paths; selector text extraction rejects images.
- Alternatives: remote URLs introduce distinct fetch/disclosure questions, and native image mappings need provider-specific formats. Defer both; no new glossary/qualifying ADR needed. Existing structural pins remain unchanged; transitive ChatContentImage source selection is a follow-up gate.
- Sources: [image input guide](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding), [official OpenAPI](https://openrouter.ai/openapi.json), installed SDK definitions. Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/inline-image-inputs.md).

## TDD plan

- First public HTTP case sends text and inline image through OpenAI/OpenRouter; expect200/exact upstream parts. Current400 demonstrates the missing behavior before implementation.
- Cover both bases, all completion modes/streams, malformed image/detail/base64/roles/cache mixtures, size/aggregate boundaries, immutable/getter captures, unsupported native pre-secret denial, auth/model/provider/Deny/limits/selection/audit/usage and upstream failures/missing usage/privacy. Actual OpenAI/OpenRouter sockets verify wire casing and complete function history continuation with fresh Deny.
- Implement smallest captures/guard/projection changes, run focused tests, format, full npm run check and fresh fixed-host compatibility:drift. Preserve all existing pins byte-for-byte.

## Delivery

- Issue/new branch/English plan, public red evidence, minimal implementation, full green checks, published diff review, two required CI checks, exact-head sjungwon03-ai approval and sjungwon03 squash merge.
- Risks: inline data is protected request content but upstream providers receive it on authorized calls; canonical encoding does not prove valid image bytes or supported model. Local limits are explicit restrictions, not official schema claims. Native/rich/cache mixtures/remote URLs/transitive image schema/full #116/unresolved #7 remain open.
- Rollback this subset as a unit; retain strict failures rather than silently flattening images.

## Verification evidence

External vision clients previously received400 for every image part. Add bounded inline user image_url parts alongside plain text through both chat bases, preserving exact order, empty text, image-only arrays and omitted/auto/low/high detail. Accept canonical nonempty base64 data:image/png/jpeg/webp/gif only, with explicit local per-URL524288-unit/history786432-unit/128-part bounds and the existing1MiB body cap. Immutable captures precede async routing/secrets; malformed encoding/types/roles/unknown fields, remote URLs, original detail and image/cache mixtures reject before routes.

Managed OpenAI/delegated OpenRouter retain the arrays on nonstream and existing text/refusal/function streams with unchanged authorized model/provider.only scope, fixed hosts, IAM/Deny, limits, required audit/usage, missing usage and safe possibly-billed failure/cancellation behavior. Native Anthropic/Gemini and exported native converters reject images before credentials rather than leaking unsupported blocks. Jev text disclosure rejects an image history before selector credentials instead of silently dropping/disclosing images; metadata-only selection remains available. No gateway image fetch, transformation, token/cost inference or operational content logging is added.

Red evidence: the initial public HTTP regression expected200 and exact upstream image/text but got400 before implementation. A second regression showed the old capture reading later image getters after an already over-budget prefix; early rejection now prevents those reads. Green:199 focused image/SDK/text/cache capture cases pass, including85 new cases. Actual installed OpenAI7.23.0/OpenRouter1.4.18 sockets exercise72 requests (64 success,8 current-Deny failures), wire casing, all completion modes/streams, correlated image/function follow-ups and fresh authorization. Raw/internal tests cover MIME/detail/encoding/size/aggregate/roles/cache rejection, exact frozen/getter/mutation captures, native pre-secret failures, auth/IAM/limits/audit/usage/transport failures, unknown usage and content-free operational records. Full npm run check passes5,379 tests with one existing PostgreSQL skip; strict types, lint, planning/contracts/fixture scan and offline integrity pass. Fresh compatibility:drift reports all three subsets unchanged and all pins remain byte-identical.

PRD, architecture, acceptance and compatibility documents plus the English plan/contract describe the bounded behavior. Official image source supports broader URL/detail/native semantics; our limits are explicit local restrictions. Canonical encoding does not certify pixels/MIME/model capability, and fixture tests do not certify live providers. Native image mappings, remote/rich/cache mixtures, output images, transitive ChatContentImage/ChatContentItems source selection, full#116 and unresolved#7 remain open.


Full npm run check passes strict types, lint, 5379 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
