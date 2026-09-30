# Function-tool schema drift coverage

## Issue and problem

- Issue: [#186](https://github.com/Theorvane/OpenGranter/issues/186).
- OpenRouter-compatible clients can send function tools and tool history, but the reviewed official-schema pin still selects only the older text-chat fields. Structural upstream changes to these supported tool shapes can escape detection.
- The current v3 projection selects thirteen request fields, two response-format definitions, and four message name fields.

## Scope and expected behavior

- Pin `tools`, `tool_choice`, and `parallel_tool_calls` on the chat request, the function-tool, named-choice and tool-call definitions, the assistant `tool_calls` property, and the tool-result message shape.
- Preserve existing field and provenance checks. Ignore editorial annotations while detecting structural and required-list changes.
- This is a conformance guard; it does not expand runtime tool support or enable streaming.
- IAM, secret, usage, and audit behavior is unchanged.

## Design

- Extend the closed projection and bump its version. Select the official structural objects without resolving external references or forwarding schema content to clients.
- Keep the whole-source SHA-256 and projection SHA-256, fixed official URL, bounded fetch, and offline check.
- A narrower projection avoids unrelated provider-specific server-tool definitions. The full `ChatFunctionTool` union remains selected so changes to its accepted alternatives still trigger review.
- Open decision: none for this guard. Future runtime support for server tools and streaming remains separate.
- See [compatibility matrix](../openrouter-compatibility.md) and [tool history contract](../../contracts/function-tool-history.md).

## TDD plan

- Add behavior tests that require tool request fields, definitions, and message structures in the projection and detect structural drift. Run the test and record the expected failure before changing the projector.
- Test missing fields, invalid definitions, unchanged editorial annotations, pin digest integrity, and fixed-source fetch.
- Extend the projector, refresh the reviewed pin from the official fixed source, and run the focused test then `npm run check`.

## Delivery

- Issue and plan first; test red; implement projector and pin; update compatibility documentation; run full checks; open PR.
- Risk: an upstream schema change during pin refresh. Compare the selected structure and record the source date/hash; do not silently accept an unexplained change.
- PR evidence: red and green test output, full check result, and remaining compatibility gaps.
