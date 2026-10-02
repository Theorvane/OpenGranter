# Safe client errors

Gateway JSON errors now include a nonempty fixed English error.message alongside their error.code and request_id; legacy /v1 retains symbolic codes and /api/v1 uses the [numeric envelope](openrouter-error-schema.md). Status and x-request-id remain unchanged. The Node bridge's pre-header internal-error fallback includes a fixed message without adding untrusted exception data.

Messages come only from a typed allowlist; caller model IDs, prompt/response bodies, proxy/provider tokens, raw upstream responses and thrown exception text never enter them. Audit failure still prevents returning inference or history; success responses are unchanged. Both client base paths and authorized history extensions use the same message projection.

This is additive client display compatibility. Precise upstream error_type propagation, retry hints and broader provider streaming-error mappings remain open; sanitized delegated errors are implemented under the [midstream contract](midstream-error-chunks.md), as recorded in [the compatibility matrix](../docs/openrouter-compatibility.md). Source: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).
