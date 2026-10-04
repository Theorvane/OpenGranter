# Scalar assistant reasoning history

Both chat bases accept optional assistant reasoning string/null for delegated
OpenRouter requests, including ordinary delegated text streams. Preserve omission,
null, empty and Unicode/newline strings exactly when assistant content is string
or normalized text parts. Ordinary null/missing assistant content normalizes to null independently of
substantive reasoning under the [no-text history contract](no-text-history.md).

Existing assistant function-call history preserves reasoning without changing
call IDs, arguments or pending result requirements. Complete tool groups remain
nonstream only; tool streams/server tools and execution are not enabled. Empty
tool-call lists also accept null/missing content on delegated nonstream paths. Reasoning on non-assistant roles,
non-string/non-null or explicit own undefined values, extra fields, malformed
content and incomplete tool results reject before routing/credentials.

HTTP and provider boundaries capture reasoning once into immutable messages
before asynchronous work; late caller mutation cannot alter the upstream payload.
Client history is untrusted conversation data, granting no authentication, routing
or tool execution authority. Direct OpenAI/Anthropic/Gemini reject every supplied
reasoning marker, including null/empty, before credentials rather than discard it.
The OpenAI SDK has no corresponding typed assistant request field; direct mapping
remains unresolved. Delegated OpenRouter carries its official field unchanged.

Authentication, complete model/provider IAM with explicit Deny, limits, required
selection/outcome audit and usage persistence retain their order and delivery
gates. Failed upstream attempts retain possible-billing accounting. History text,
reasoning and keys never enter operational audit, ledger metadata or errors.
Missing usage is not inferred from history. Model/provider support and output
completeness are not guaranteed by request forwarding.

Actual OpenRouter SDK sockets cover both bases and delegated nonstream/text
streams. Official ChatMessages maps assistant inputs to ChatAssistantMessage,
whose content and reasoning are independent optional nullable fields; pin v16
selects that definition, but full ChatMessages reference traversal remains open.
Detailed history is covered by [its contract](client-reasoning-details-history.md).
Native mappings, structured reasoning request controls and complete external-client
certification remain under #116.

Sources: installed SDK 1.4.18 and [official OpenAPI](https://openrouter.ai/openapi.json).
See [plan](../docs/plans/304-assistant-reasoning-history.md) and
[function-history contract](function-tool-history.md).
