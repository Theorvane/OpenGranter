# Client output token limits

Both POST chat paths accept optional max_tokens as a positive safe integer. Zero, negative, fractional, unsafe, non-finite and nonnumeric supplied values reject. HTTP invalid values produce required metadata denial before route/limit/secret/provider work. Direct adapter callers receive existing safe non-retryable, non-billable configuration/other failures before secret resolution or transport.

OpenRouter/OpenAI forward the captured value as max_tokens. Anthropic maps it to max_tokens; Gemini maps it to generationConfig.maxOutputTokens. A direct registration maxOutputTokens bounds a supplied request to the smaller maximum. Omitting the field preserves existing behavior: Anthropic uses its required configured value; other adapters omit an explicit client maximum. The captured primitive survives changes to the input object during asynchronous secret lookup.

IAM, request limits, audit and usage apply identically to requests with the field. The parameter does not grant access or reserve a token budget. Model context windows and support for reasoning-specific limits remain separate compatibility work. No raw provider content or credentials enter errors or normal audit.

Sources: [OpenRouter parameters](https://openrouter.ai/docs/api_reference/parameters), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini generation](https://ai.google.dev/api/generate-content).
