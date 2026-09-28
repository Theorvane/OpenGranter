# Client stop sequences

Both chat paths accept optional stop as a string or dense array of up to four strings, including empty arrays. Null/omission means no explicit stop parameter. Preserve literal strings, Unicode and order. Numbers, objects, mixed/sparse arrays and more than four entries reject before external work. Invalid HTTP values receive required metadata denial and the existing safe request error; invalid adapter values use safe non-retryable, non-billable failures before secrets.

OpenRouter/OpenAI preserve string or array stop. Anthropic maps a string to one-element stop_sequences and arrays unchanged; Gemini maps similarly to generationConfig.stopSequences. Gemini combines stopSequences with maxOutputTokens rather than replacing output settings. Capture and freeze arrays before secret awaits; original input remains mutable for subsequent calls.

IAM, limits, audit and usage are unchanged. Do not include stop contents in ordinary audit or errors. Model-specific stop support and larger provider-native lists remain compatibility work; this is the portable text-chat slice.

Sources: [OpenRouter unified schema](https://openrouter.ai/docs/api_reference/overview), [OpenAI stop limits](https://help.openai.com/en/articles/5072263-how-do-i-use-stop-sequences-in-the-openai-api), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini generation](https://ai.google.dev/api/generate-content).
