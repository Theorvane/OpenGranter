# Bounded management catalog responses

Refs #637/#639 and [plan](../docs/plans/639-catalog-bounded-json.md).

Successful list and detail reads accept at most 1,048,576 received body bytes, inclusive. Oversized declared lengths are rejected before consumption; actual streamed bytes are counted even if the header is absent or false. Overflow returns `unavailable`, never partial rows or private response text. An oversized catalog needs future server pagination; the client does not silently truncate or retry.

The client cancels active readers on invalidation, deadline or read failure without waiting for cleanup. Existing non-200 status mapping, 30-second deadline, schema validation, projection and authorization port remain unchanged. Cancellation cannot undo server audit or work. This bounds client-buffered JSON bytes, not upstream allocation, decompressor memory, JSON object overhead or server resource use. Browser login, session activation and installed acceptance remain separate gates.

## Response encoding (#639)

Successful catalog bodies must be well-formed UTF-8. Decode the complete bounded byte sequence with fatal error handling before JSON parsing. Invalid, truncated, overlong or surrogate encodings return only unavailable; never replace them with U+FFFD and render altered identifiers or publishers. Valid multibyte Unicode remains unchanged across response chunks. Non-200 errors retain status-only authentication/denial mapping without body parsing. No session or permission grant is introduced.

## List navigation integrity (#639)

Every list row must pass the same alias validation as detail navigation. Proxy collection aliases count/user remain reserved; SSO does not inherit those proxy exclusions. Duplicate exact IDs reject the entire list as unavailable, without silent deduplication or partial display. Unicode and exact-case-distinct IDs remain unchanged. A malformed refresh replaces any previous detail with loading then unavailable; it does not retain stale private content. This is a client navigation invariant, not new server authority or a publication permission.
