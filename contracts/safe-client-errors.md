# Safe client errors

Gateway JSON errors now include a nonempty fixed English error.message alongside their existing symbolic error.code and request_id. Status and x-request-id remain unchanged. The Node bridge's pre-header internal-error fallback includes a fixed message without adding untrusted exception data.

Messages come only from a typed allowlist; caller model IDs, prompt/response bodies, proxy/provider tokens, raw upstream responses and thrown exception text never enter them. Audit failure still prevents returning inference or history; success responses are unchanged. Both client base paths and authorized history extensions use the same message projection.

This is additive client display compatibility. OpenRouter numeric code/status conformance, typed metadata, retry hints and streaming error formats remain open in [the compatibility matrix](../docs/openrouter-compatibility.md). Source: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging).
