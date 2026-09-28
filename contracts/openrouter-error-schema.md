# OpenRouter numeric error envelopes

Requests whose pathname starts /api/v1/ receive JSON failures with numeric error.code equal to HTTP status, fixed error.message and metadata.opengranter_code containing only the existing allowlisted symbolic reason. The gateway retains request_id and x-request-id. The Node pre-header internal fallback has the same format without inventing a request ID.

Legacy /v1 errors retain symbolic code and fixed message. Success payloads and every IAM, audit, limit and usage behavior remain unchanged. Choosing an error format does not change endpoint eligibility: unknown endpoints, wrong methods and near misses remain 404, and history extensions stay on /v1.

Only allowlisted metadata is produced. Raw exception/provider bodies, prompts and credentials remain excluded. Numeric envelope conformance does not implement standard upstream error_type, retry hints or streaming errors. See [compatibility](../docs/openrouter-compatibility.md) and [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).
