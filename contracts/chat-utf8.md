# Chat body UTF-8 contract

The authenticated `POST /v1/chat/completions` JSON boundary accepts well-formed UTF-8. Invalid sequences and incomplete sequences at end of input produce the existing `400 invalid_request` response and metadata-only `request-denied` audit with `invalid-request` reason. No route resolution, limit check, credential resolution, inference, or usage write follows invalid input.

A decoding failure cancels unread body input and releases the reader lock. Cancellation failures cannot expose input or change the validation response. Denial-audit failure produces `503 audit_unavailable` as before.

Valid characters split across chunks are buffered until complete. A literal U+FFFD character is valid and preserved. The existing one-MiB limit applies to bytes, not decoded characters. This contract does not add content auditing, output streaming, or provider-specific request fields.
