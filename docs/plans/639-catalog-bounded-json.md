# Bound management catalog JSON reads

1. Refs #637/#639. Bound successful catalog bodies to 1 MiB of received bytes before JSON parsing. Both list and detail fail safely as unavailable on overflow, with no partial rows or automatic retries. This is a browser resource bound, not pagination or a new server catalog limit.
2. Record RED for oversized declared and chunked bodies, exact boundary, split UTF-8, abort during consumption and rejected/stalled cleanup. Existing error status mapping and 30-second deadline remain.
3. Consume the response stream with a byte counter; cancel on overflow or read interruption without waiting for cleanup. Do not trust Content-Length as the only limit. Decode and project only a complete bounded body.
4. Run focused client/session/authority tests, typecheck, lint and planning checks. Require exact-head CI and independent formal approval before merge. No session, authorization, audit, provider, runtime or deployment changes. Browser SSO acceptance remains blocked on its separate contract.
