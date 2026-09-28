# Chat request media type

Authenticated POST /v1/chat/completions requests require application/json as the exact case-insensitive media type before the first semicolon. Trim surrounding whitespace in the type segment. Existing parameter handling is preserved; this adds no charset negotiation or parameter grammar validation.

Missing types, unrelated types, JSON prefix lookalikes, structured suffix variants, and ambiguous comma-joined type segments use the existing 400 invalid_request response and metadata-only invalid-request denial audit. No route, limit, secret, inference, or usage work follows rejection. Denial-audit failure remains 503 audit_unavailable. Authentication remains first, including for malformed or unsupported media declarations.

Strict UTF-8 decoding and the existing one-MiB body cap remain unchanged. Additional content types require a separate API capability decision.
