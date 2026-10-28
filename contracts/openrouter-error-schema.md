# OpenRouter numeric error envelopes

Requests whose pathname starts /api/v1/ receive JSON failures with numeric error.code equal to HTTP status, fixed error.message and metadata.opengranter_code containing only the existing allowlisted symbolic reason. The gateway retains request_id and x-request-id. The Node pre-header internal fallback has the same format without inventing a request ID.

Legacy /v1 errors retain symbolic code and fixed message. Success payloads and every IAM, audit, limit and usage behavior remain unchanged. Choosing an error format does not change endpoint eligibility: unknown endpoints, wrong methods and near misses remain 404, and history extensions stay on /v1.

Only allowlisted metadata is produced. Raw exception/provider bodies, prompts and credentials remain excluded. Local typed error metadata does not recover precise upstream error causes or streaming errors; bounded nonstream retry headers are defined below. See [compatibility](../docs/openrouter-compatibility.md) and [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).

## Safe local typed errors

On /api/v1 paths, metadata.error_type uses a fixed allowlist alongside opengranter_code:

| Local reason | error_type |
| --- | --- |
| not_found, unknown_model | not_found |
| unauthorized | authentication |
| invalid_request | invalid_request |
| forbidden | permission_denied |
| limit_exceeded | rate_limit_exceeded |
| upstream_failed | unmapped |
| authentication_unavailable, audit_history_unavailable, usage_unavailable, catalog_unavailable, route_unavailable, credential_unavailable, audit_unavailable, internal_error | server |

These are local reason mappings, not recovered upstream diagnostics. In particular, server-held key failures are not client authentication failures and a generic upstream failure does not prove timeout, rate limiting, provider availability or moderation. The Node fallback maps internal_error to server. All statuses, fixed messages, request identifiers and legacy /v1 shape remain unchanged. No raw provider metadata or caller content is accepted by the serializer. HTTP-date/streaming retry hints, precise provider-cause propagation and full streaming parity remain open.

Source checked 2026-09-29: [OpenRouter typed error codes](https://openrouter.ai/docs/api_reference/errors-and-debugging).

## Bounded nonstream Retry-After (#548)

Both POST chat bases retain an advisory Retry-After from registered delegated OpenRouter or direct OpenAI/Anthropic/Gemini nonstream 429/503 responses. The gateway still returns 502 upstream_failed with its existing fixed body, numeric/symbolic format, unmapped compatible error_type and request identifiers. It does not assert that the proxy token itself is rate limited or change client retry eligibility. For example, upstream 429 with Retry-After:0007 yields the existing 502 error with Retry-After:7.

Capture only the HTTP-normalized header value consisting of 1..16 ASCII digits and a nonnegative safe-integer number of seconds. Zero is valid and leading zeros canonicalize. Missing/empty values, signs/fractions/exponents, commas/repeated fields, unsafe integers, overlong values, private strings and HTTP dates are omitted without replacing the original safe error. HTTP dates are allowed by the standard but remain outside this bounded implementation. No raw headers or provider error bodies pass through.

Known adapter failures and route results carry only an optional validated retryAfterSeconds scalar for rate-limit/server-error categories. Constructors, coordinators and the error serializer revalidate their respective boundaries. Only terminal upstream-failed/provider-failed results after successful required usage and outcome-audit handoffs can produce the header; persistence failures return their existing 503 without a hint. Successful fallback clears earlier hints, and a later terminal attempt may supply only its own hint. Current responseStarted/possiblyBilled flags, conservative missing-usage records and fallback eligibility remain unchanged.

No hints are emitted for other upstream statuses, success, local auth/IAM/limits/configuration/secret failures or timeouts. The hint is excluded from audit-event bodies, ledger fields and public error JSON. Streaming remains unchanged and is not covered by this header contract. No gateway sleep/retry, availability guarantee, duplicate-billing protection, HTTP-date normalization or full OpenRouter error parity is introduced. A new client retry still authenticates and evaluates current policy/limits normally.

Actual pinned OpenAI 7.23.0/OpenRouter 1.4.18 and OpenRouter AI SDK provider 3.1.0 with AI SDK 7.0.153 receive the canonical header across both bases/four routes with retries disabled. This certifies header delivery, not each SDK's automatic backoff behavior. See [plan](../docs/plans/548-upstream-retry-hints.md) and [compatibility](../docs/openrouter-compatibility.md). Primary sources checked 2026-10-28: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging) and [RFC 9110 section 10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after). Full #116 and unresolved Jev #7 stay open.
