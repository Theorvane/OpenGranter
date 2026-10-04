# Assistant refusal history

Both chat bases preserve optional assistant refusal strings/null on delegated
OpenRouter and direct OpenAI ordinary and complete nonstream function histories.
Omission stays omitted; explicit null/empty/Unicode/newline values stay exact.
Existing assistant content normalization applies: missing becomes null. Direct
OpenAI accepts canonical null with a supplied validated refusal marker, including
null/empty, while bare-null ordinary/empty-call histories remain unsupported.
This is structural forwarding, without guarantees of semantic model acceptance.

Existing delegated ordinary text streams also preserve refusal history. Tool
fields/direct streams remain unsupported. Single assistant refusal content parts
follow the HTTP [translation contract](client-refusal-parts.md). Preserve
call IDs/arguments and complete pending results; refusal never resolves a pending
call or grants authentication, routing, policy or tool execution authority.

Only assistant owns this field. Non-string/non-null, explicit own undefined,
non-assistant markers, unknown fields and malformed content/tool groups reject
before routing/credentials. Capture supplied refusal once, freeze projected own
fields before async work and retain no inherited marker. Direct Anthropic/Gemini
reject every supplied marker pre-secret, even null/empty with visible content.
Native refusal mapping remains unresolved rather than silently discarding data.

Authentication, complete model/provider IAM with explicit Deny, limits, required
usage/audit delivery gates and safe possibly-billed failures stay shared. No
history/refusal/content/key enters operational audit, ledger metadata or errors.
Missing usage remains unknown; history cannot infer zero billing or usage.

Actual OpenAI/OpenRouter SDK sockets replay nullable/empty/string histories on
both bases; delegated SDK also covers ordinary text streams. Current
[OpenAI assistant request reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
and installed SDK support the shape. Earlier retrieved OpenRouter assistant schema
supports it; fresh full-source comparison is not asserted. Pin v18 already selects
that assistant definition and remains unchanged. Full #116 certification stays open.

See [plan](../docs/plans/330-refusal-history.md),
[no-text history](no-text-history.md) and [function groups](function-tool-history.md).
