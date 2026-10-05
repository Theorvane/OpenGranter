# Client end-user request metadata

## Issue and problem

Issue: [#428](https://github.com/Theorvane/OpenGranter/issues/428), continuing #116 after #426. External OpenAI/OpenRouter clients can send an optional user string for upstream attribution; the gateway currently rejects this request field.

## Scope and expected behavior

Both API bases accept an optional non-nullable string user on text/refusal/function nonstream and streaming requests. Preserve exact empty, whitespace, Unicode and case-sensitive strings without trimming, hashing, coercion or derived defaults. Omission omits the upstream field. Null and other types fail safely before route/secret work. This matches current OpenRouter and both installed SDK types; OpenAI HTTP's broader nullable allowance remains outside this explicit subset. Existing HTTP body size bounds apply; no unsupported source-prose string limit is introduced.

Only managed OpenAI and delegated OpenRouter forward the captured field before secret awaits. Native Anthropic/Gemini reject every supplied string before credentials, including empty strings, until an exact native contract is agreed. Native Anthropic metadata.user_id has different constraints; Gemini labels have different semantics. Never silently map either. Client user does not authenticate or authorize anything. IAM, limits, ledger principal/credential/policy attribution and operational audit continue using the authenticated principal. Never echo the field into responses, errors, operational logs or records.

Extend the source pin to version 21 with exactly 26 request fields, adding user and preserving all prior definitions/maps. Detect type/nullability/required/default/bounds/extension drift without inventing local runtime limits in source structure. Retain annotations-insensitive comparison and existing trusted fixed-host retrieval.

Out of scope: native identity mappings, user registration endpoints, generating/hash identity defaults, safety_identifier/prompt_cache_key, response or billing metadata, capability certification, full #116 and unresolved #7.

## Design

Add one pure optional string validator reused at the public client and both upstream request boundaries. Capture once before asynchronous work, forward only from the existing fixed-host OpenAI/OpenRouter prepared body, and retain all routing/delivery controls. Change no policy or ledger schema. Extend the selected source field and pin version after red structural tests, refreshing the fixed official source and checking every previous selection remains equal.

Repository grilling delegated read-only facts from the [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), [user tracking guide](https://openrouter.ai/docs/cookbook/administration/user-tracking), [OpenAI create reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini generation](https://ai.google.dev/api/generate-content), and installed SDK definitions. The field is caller-provided upstream metadata, not authenticated principal identity. No domain term, costly ADR or unresolved architectural choice is introduced.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), and [contract](../../contracts/client-user.md).

## TDD plan

First public HTTP/adapter cases expect exact upstream forwarding and authenticated ledger attribution. Expected red: unknown-field HTTP 400 and missing upstream user metadata. Cover omission/empty/Unicode/whitespace, malformed/null values, direct unsupported providers, immutable single accessor capture, both bases, nonstream/stream text/refusal/functions, both actual SDKs, authentication/implicit and explicit model/provider Deny, limits, selection/outcome audit and usage failure, safe transport failure and no operational metadata leak. First source cases detect user drift and expect a version-21 selected field while old implementation omits it.

Implement the smallest pure validator and existing request preparation changes; update pin/version and exact fixtures. Run npm run format, focused checks, full npm run check, and explicit fixed-host npm run compatibility:drift. Keep strict TypeScript and no production tests that repeat validator internals.

## Delivery

Issue and new branch precede this English plan and tests; record actual red/green and source retrieval evidence in the PR. Require sjungwon03-ai exact-head approval and both exact-head CI jobs, then sjungwon03 squash merge and clean main synchronization. Rollback removes the optional field and restores the prior pin; no storage migration. Fixture SDK checks do not certify live models or full compatibility.

## Reviewed provenance

Fresh official retrieval on 2026-10-05 yields canonical source SHA-256 0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458 and version-21 projection SHA-256 f1ed75fd51a3691bf90663f3f9cc3f72f489155ed7597dd9f24d08bb7e44ad6b. Removing only user reproduces the previous version-20 projection exactly. The full source changed outside earlier selections; no unselected endpoint/capability change is enabled by this refresh. Explicit fixed-host compatibility:drift passes.

## Verification evidence

External OpenAI/OpenRouter clients previously received an unknown-field error when sending `user`. Both API bases now preserve an optional exact string in managed OpenAI/delegated OpenRouter nonstream and streaming text/refusal/function requests. Capture occurs once before credentials. Empty, whitespace, Unicode and case-sensitive values retain their original form; omission preserves defaults, and null/malformed values reject safely. Authenticated principal, credential and policy attribution continue governing IAM, limits, audit and ledger records. The caller identifier is not echoed, logged, hashed locally or derived from the principal.

Native Anthropic/Gemini supplied values fail before credentials rather than silently mapping to constrained `metadata.user_id` or unrelated labels. The subset follows current OpenRouter and installed SDK types; OpenAI HTTP's nullable allowance, native identity mappings and newer replacement fields remain explicit gaps. Existing HTTP body limits, failure accounting and required delivery handoffs remain effective.

- Red: public request/SDK/source tests failed 159 of 287 cases before implementation; failures reproduced unknown-field rejection, missing pre-secret forwarding and absent source selection. Existing denial and source cases passed. Corrected source-test expectations to the existing raw-field projection shape without changing implementation behavior.
- Green: focused user/probability/Gemini/SDK/source regression suite passes 774 tests. Added 176 cases covering exact values, malformed/null inputs, authenticated attribution, model/provider Deny and limits, selection/persistence/transport failures, single accessor capture and safe accessor failure. The test input helper now preserves property descriptors so accessors reach the public adapter boundary.
- Both actual installed SDKs complete 48 fixture-backed socket requests across managed OpenAI/delegated OpenRouter, both bases, text/refusal/functions and nonstream/stream modes. No live inference or model guarantee is claimed.
- Version 21 selects 26 request fields, adding only `user`; removing it reproduces the previous projection exactly. Fresh official source SHA-256: `0f220980d0c335ca4b4efd5684e1055f88eb84e73d4e34b0b9a859c9d2cf0458`; projection SHA-256: `f1ed75fd51a3691bf90663f3f9cc3f72f489155ed7597dd9f24d08bb7e44ad6b`. Source changes outside earlier selections do not enable new capabilities. Explicit fixed-host `npm run compatibility:drift` passes.

No policy/ledger/storage migration, credential, SDK dependency, destination or workflow authority change. Full #116 and unresolved #7 remain open.


Full npm run check passes strict types, lint, 3470 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
