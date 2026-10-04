# Delegated no-text assistant history

Both chat bases accept ordinary delegated OpenRouter assistant messages with null
or omitted content independently of substantive scalar reasoning or detailed
payloads. Missing content normalizes to null. Preserve optional name, validated
empty/null scalar reasoning, empty/metadata-only detailed arrays and exact opaque
payloads. Empty tool-call lists also accept null/missing content in nonstream
history; all histories with tool fields remain unsupported on text streams.

HTTP normalization and immutable provider snapshots retain exact allowed fields.
Malformed content/details/calls, non-assistant null/missing content, unknown fields,
orphan/duplicate/incomplete tool results and interrupted pending groups reject
before routing or secrets. Null history grants no authentication, policy, routing
or tool execution authority; no fabricated assistant text is supplied.

Direct OpenAI/Anthropic/Gemini reject bare-null ordinary/empty-call assistant histories
before credential lookup. Direct OpenAI supplied refusal follows the
[refusal history contract](client-refusal-history.md). Existing direct OpenAI nonempty complete function groups
remain supported. Native optional-content mapping remains unresolved; this local
subset restriction is not a claim that every provider prohibits null history.

Authentication, complete model/provider IAM with explicit Deny, limits, required
usage/audit persistence and safe possibly-billed failures retain their gates.
History/content/keys stay out of operational events, ledger metadata and errors.
Missing usage remains unknown; no cost or token count is inferred from history.

Actual pinned OpenRouter SDK sockets replay omitted/null ordinary histories on
both bases for nonstream and ordinary text streams. Earlier retrieved assistant
schema and SDK support optional nullable content; fresh source retry timed out,
so no fresh full-source comparison is asserted. Pin v18 remains unchanged.
Native/rich/server-tool/tool-stream and complete #116 certification remain open.

See [plan](../docs/plans/328-no-text-history.md),
[scalar history](client-reasoning-history.md),
[detail history](client-reasoning-details-history.md), and
[function groups](function-tool-history.md).
