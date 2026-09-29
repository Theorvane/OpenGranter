# Single-choice client contract

Omitted n or numeric 1 is supported on both chat paths and all four adapters. Null, other counts, nonnumeric/non-finite values reject before route/credential/provider work using existing safe failures and required HTTP denial audit. This is explicitly a one-choice subset, not general n support; multi-choice accounting/response behavior remains open.

OpenRouter/OpenAI forward supplied n=1. Gemini maps to generationConfig.candidateCount=1 alongside sampling/stop/output settings. Anthropic already returns a single message and receives no unsupported native n field. Omission adds no explicit count; adapters capture supplied primitives before asynchronous credential lookup. Input mutation cannot widen the count later. Administrator output caps and all IAM, limit, audit and usage controls remain effective.

Official OpenAI SDK 7.23.0 is pinned as a development-only dependency. Loopback socket smoke tests configure the local baseURL and synthetic proxy token, disable retries, and exercise discovery/text chat and denial/failure errors with fake upstreams. No official OpenAI host or live key is used. These tests do not implement streaming/tools, validate the entire upstream response schema, or certify any named external application's complete workflow. Full compatibility remains open under #116.

Sources checked 2026-09-29: [OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat/create), [official SDK libraries](https://developers.openai.com/api/docs/libraries), [OpenRouter API overview](https://openrouter.ai/docs/api_reference/overview).
