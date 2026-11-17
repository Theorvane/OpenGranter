# Token mutation response integrity

- Issue and revoke success responses must satisfy existing status, media type and exact shape checks.
- For absent/identity Content-Encoding, an optional Content-Length must be decimal digits, a safe nonnegative integer within the decoded-byte cap (131072 issue; 4096 revoke). Reject invalid declarations before pulling a body. Reject overflow immediately and underflow at EOF. Count UTF-8 bytes, not UTF-16 units.
- Fetch exposes decoded compressed bodies: do not compare compressed wire length to decoded size. The decoded-byte bound, strict UTF-8, JSON and exact shape checks remain mandatory.
- Failure returns uncertain, never partial token data or upstream diagnostics. Do not retry: a server-side mutation may already have committed. Caller cancellation, ten-second overall bound and no automatic replay remain unchanged. Dispose readers without awaiting an uncooperative producer.
- Tests cover both public clients, exact and mismatched lengths, stalled producers, malformed UTF-8, decoded overflow, denial, cancellation and owned loopback HTTP with signed synthetic SSO plus migrated embedded PostgreSQL. The HTTP test changes response metadata at the injected transport boundary; it is not a native wire-truncation or installed browser/provider test.
