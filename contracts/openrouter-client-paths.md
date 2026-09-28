# OpenRouter client base paths

POST /api/v1/chat/completions and GET /api/v1/models are exact aliases for their /v1 counterparts. They execute the same authentication, IAM, limits, route, required audit and usage logic without redirecting or forwarding the incoming path upstream.

Clients configure the gateway origin plus /api/v1 as base URL and their OpenGranter proxy token as the Bearer API key. Optional client app-identification headers do not grant authority or replace server-held upstream credentials. Published aliases remain IAM filtered.

Wrong methods, near-miss paths and unknown /api/v1 endpoints remain 404. OpenGranter history extensions retain their documented /v1 paths. Existing unsupported fields fail validation; this contract provides path compatibility, not complete OpenRouter schema compatibility. See [compatibility status](../docs/openrouter-compatibility.md).

Execution and successful payloads are shared; failure envelopes use [numeric OpenRouter codes](openrouter-error-schema.md) on /api/v1 and retain legacy symbolic codes on /v1. Status and safe reason semantics remain identical.
