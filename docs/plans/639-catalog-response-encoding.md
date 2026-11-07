# Reject corrupted catalog response encoding

## Issue and problem

- Issue: #639, parent #637.
- The management client decodes API bytes using replacement-mode UTF-8. A malformed response can become a different model identifier or publisher and be rendered as successful data.

## Scope and expected behavior

- Reject malformed UTF-8 in successful list/detail bodies as unavailable; do not render replacement identifiers.
- Preserve valid Unicode, byte/resource limits, cancellation, fresh authority and safe error mapping.
- No authentication, session, IAM, schema, endpoint or runtime activation change. No provider calls or usage effects.

## Design

1. Keep bounded byte collection and decode the complete body using fatal UTF-8 before JSON parsing.
2. Reuse existing safe unavailable and body-cleanup paths for decode failure.
3. Exercise actual Node HTTP and fetch bytes, not a predecoded response fixture.

## TDD plan

1. RED: actual list and detail responses with a lone invalid byte inside an otherwise valid identifier incorrectly return ready.
2. GREEN: fatal decoding rejects both; valid multibyte Unicode across HTTP writes remains unchanged.
3. Verify truncated and overlong encodings fail, while authorization status mapping and subsequent valid reads remain functional.
4. Run targeted client/session tests, typecheck, lint, planning checks and full npm run check.

## Delivery

- Contract: contracts/management-catalog-bounded-json.md.
- Rollback: revert the client decode change; no stored data or migrations change.
- Exact-head CI and independent formal approval required before merge.
- Local socket tests do not certify company SSO, a real browser login, installed PostgreSQL or providers.

## Execution evidence (2026-11-05)

- Node22 actual loopback HTTP/fetch RED: list returned ready with altered model ID, detail returned ready with altered publisher; 2 failed/2 passed. Log: /tmp/og-1700-encoding-red.log.
- Same unchanged cases GREEN after fatal decoder: malformed list/detail, valid Unicode and private status errors all pass. Combined client/session/encoding suite: 35 passed, 0 failed, 0 skipped. Log: /tmp/og-1700-encoding-green.log.
- Typecheck, changed-file Biome, planning checker and diff whitespace check passed. Full npm run check started separately; no full-suite success claimed before completion.
- Session choice/IdP, real browser login, installed PostgreSQL and provider authorization remain external gates; this does not implement or authorize them.
