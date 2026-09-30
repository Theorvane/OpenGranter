# Streaming response schema drift guard

## Issue and problem

- Issue: [#193](https://github.com/Theorvane/OpenGranter/issues/193).
- The reviewed official-schema pin covers selected chat requests and function-tool history but not the streaming response definitions that the internal parser and chunk decoder are beginning to use.

## Scope and expected behavior

- Select the official ChatStreamChunk, ChatStreamChoice, ChatStreamDelta and ChatStreamOptions definitions into a separate closed `streamDefinitions` map. Bump the pin version and refresh it from the fixed official source.
- Detect structural and required-list changes, missing/malformed definitions and stale/rehashed pin maps. Continue ignoring editorial annotations and unrelated schemas.
- This is an offline/live drift guard only. It does not validate response instances, enable `stream:true`, affect IAM, access secrets or alter usage/audit behavior.

## Design

- Keep request `definitions` separate from stream `streamDefinitions` so the selected response surface is explicit. Reuse existing recursive canonicalization, provenance hash, bounded fixed-host fetch and safe failures.
- Select the four definitions structurally without recursively expanding references to tool, audio, reasoning or error definitions. Broader response conformance remains a later decision.
- The current OpenAPI ChatStreamOptions marks `include_usage` deprecated; selecting it records that source behavior without adding a runtime parameter.
- See [schema contract](../../contracts/openrouter-schema-drift.md), [compatibility matrix](../openrouter-compatibility.md), and [acceptance](../acceptance.md).

## TDD plan

- Add tests requiring all four response definitions and demonstrating structural drift with unchanged references. Record the expected red result against the version-4 projector.
- Add missing/malformed definitions, annotation-only changes and stale/rehashed map cases; then extend the projector and refresh the reviewed pin.
- Run focused tests, `npm run check`, and one explicit `npm run compatibility:drift` against the fixed official source.

## Delivery

- Issue and plan; red; projector/pin; contract and compatibility docs; green/full/live checks; PR.
- Risk: a live upstream schema revision during refresh. Review selected differences and preserve the source date/hash; never auto-rewrite a pin from the check command.
- PR evidence: red/green, full checks, live comparison and remaining scope.
