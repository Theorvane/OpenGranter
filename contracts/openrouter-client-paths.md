# OpenRouter client base paths

POST /api/v1/chat/completions and GET /api/v1/models share execution boundaries with their /v1 counterparts, with protocol-specific response projections. They execute the same authentication, IAM, limits, route, required audit and usage logic without redirecting or forwarding the incoming path upstream.

Clients configure the gateway origin plus /api/v1 as base URL and their OpenGranter proxy token as the Bearer API key. Optional client app-identification headers do not grant authority or replace server-held upstream credentials. Published aliases remain IAM filtered.

Only /api/v1/models adds configured trusted discovery metadata, visible total_count and relative continuation links for bounded offset/limit paging; /v1 remains basic. Missing metadata preserves the basic-entry SDK gap. See [discovery contract](model-discovery-metadata.md) and [paging contract](model-list-paging.md).

Wrong methods, near-miss paths and unknown /api/v1 endpoints remain 404. OpenGranter history extensions retain their documented /v1 paths. Existing unsupported fields fail validation; this contract provides path compatibility, not complete OpenRouter schema compatibility. See [compatibility status](../docs/openrouter-compatibility.md).

Execution and supplied completion metadata are shared. Compatible nonstream /api/v1 completions project unavailable system_fingerprint as null while /v1 retains omission; see [fingerprint projection](compatible-completion-fingerprints.md). Failure envelopes use [numeric OpenRouter codes](openrouter-error-schema.md) on /api/v1 and retain legacy symbolic codes on /v1. Status and safe reason semantics remain identical.
