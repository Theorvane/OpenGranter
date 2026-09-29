# Upstream single-choice response contract

OpenAI and OpenRouter native choices must be arrays of exactly one item whose index is numeric 0. Gemini native candidates must be arrays of exactly one item; index may be omitted, but if supplied it must be numeric 0. Empty, extra, sparse, nonarray or malformed collections reject through existing safe post-response failures. No extra alternative is silently discarded.

Anthropic text content can contain multiple text blocks within one message. These remain joined under its single-message normalization contract; they are not multiple choices. Other existing role/content/usage validation stays effective.

Provider response rejection preserves response-started and possible-billing metadata. The gateway records failed-attempt audit and usage with unknown token reporting as appropriate; it does not invent usage from discarded native alternatives, replay inference or expose raw content/errors. IAM, limits and required audit still run before provider transport, and existing retry/fallback boundaries remain unchanged.

This enforces the current normalized one-choice contract. It does not implement multichoice, complete official response schemas, streaming or tools. Client n=1 is tracked independently in PR #135; full compatibility remains open under #116.
