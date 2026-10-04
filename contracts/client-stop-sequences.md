# Client stop sequences

Both chat paths accept optional stop as a string or dense array of up to four strings, including empty arrays. Null/omission means no explicit stop parameter. Preserve literal strings, Unicode and order. Numbers, objects, mixed/sparse arrays and more than four entries reject before external work. Invalid HTTP values receive required metadata denial and the existing safe request error; invalid adapter values use safe non-retryable, non-billable failures before secrets.

OpenRouter/OpenAI preserve string or array stop. Anthropic maps a string to one-element stop_sequences and arrays unchanged; Gemini maps similarly to generationConfig.stopSequences. Gemini combines stopSequences with maxOutputTokens rather than replacing output settings. Capture and freeze arrays before secret awaits; original input remains mutable for subsequent calls.

IAM, limits, audit and usage are unchanged. Do not include stop contents in ordinary audit or errors. Model-specific stop support and larger provider-native lists remain compatibility work; this is the portable text-chat slice.

Sources: [OpenRouter unified schema](https://openrouter.ai/docs/api_reference/overview), [OpenAI stop limits](https://help.openai.com/en/articles/5072263-how-do-i-use-stop-sequences-in-the-openai-api), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini generation](https://ai.google.dev/api/generate-content).

## Capture consistency

The public snapshot validates one captured array length as a safe integer from
zero to four and reads each indexed value once. It never executes a caller-supplied
iterator. Later length changes or appended entries cannot expand the captured
range; only the validated strings enter the frozen copy. Invalid first values and
throwing indexed accessors fail safely at adapter boundaries before secrets.
Existing indexed property lookup, including inherited string values for local
programmatic arrays, is preserved; an unresolved hole still rejects. JSON arrays
retain the same dense-string contract and native mappings.

These regressions concern local accessor/Proxy/iterator inputs; HTTP JSON cannot
contain them. Sequential capture does not promise atomic arbitrary object graphs.
IAM, limits, required persistence, usage and operational privacy remain shared.
See [plan](../docs/plans/342-stop-capture.md); model-specific constraints and full
external-client compatibility remain under #116.
