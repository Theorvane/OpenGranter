# OpenRouter numeric error envelopes

Requests whose pathname starts /api/v1/ receive JSON failures with numeric error.code equal to HTTP status, fixed error.message and metadata.opengranter_code containing only the existing allowlisted symbolic reason. The gateway retains request_id and x-request-id. The Node pre-header internal fallback has the same format without inventing a request ID.

Legacy /v1 errors retain symbolic code and fixed message. Success payloads and every IAM, audit, limit and usage behavior remain unchanged. Choosing an error format does not change endpoint eligibility: unknown endpoints, wrong methods and near misses remain 404, and history extensions stay on /v1.

Only allowlisted metadata is produced. Raw exception/provider bodies, prompts and credentials remain excluded. Local typed error metadata does not recover precise upstream error causes, retry hints or streaming errors. See [compatibility](../docs/openrouter-compatibility.md) and [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).

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

These are local reason mappings, not recovered upstream diagnostics. In particular, server-held key failures are not client authentication failures and a generic upstream failure does not prove timeout, rate limiting, provider availability or moderation. The Node fallback maps internal_error to server. All statuses, fixed messages, request identifiers and legacy /v1 shape remain unchanged. No raw provider metadata or caller content is accepted by the serializer. Retry hints, precise provider-cause propagation and streaming remain open.

Source checked 2026-09-29: [OpenRouter typed error codes](https://openrouter.ai/docs/api_reference/errors-and-debugging).
