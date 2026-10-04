# Internal function stream client SSE projection

- A separate encoder preserves bounded indexed function fragments and tool_calls finish reasons using safe JSON framing. Partial arguments stay literal response content with no parsing or execution.
- Function fragments are forbidden on usage events and in the text encoder; malformed values fail with fixed errors. Missing usage emits no fabricated counts.
- Existing metadata, text, reasoning, usage and DONE projection stays shared; the public HTTP function-stream gate remains closed.

Response fragments/calls are confidential response content. No key, prompt,
argument or response enters operational audit/usage/error metadata. This
internal stage does not activate public HTTP tool streams or certify #116.
