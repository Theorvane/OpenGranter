# Usage JSON response framing (#642)

## 1. Problem and scope
The usage list still rejects compressed wire Content-Length over 2 MiB even when Fetch-decoded JSON is within the existing cap, and waits for EOF after identity bytes exceed the declared length. Fix only the usage JSON client; retain filters, projection, status mapping, authorization and UI ownership. No new endpoint or security decision.

## 2. Tests first
Reproduce early cancellation of an identity producer stalled after exceeding its declared length. Exercise decoded JSON with compressed wire metadata separately from native HTTP. Use native loopback HTTP and Fetch for valid Unicode gzip pages, gzip level-zero wire length above the cap with exactly capped decoded JSON, decoded overflow and identity truncation. Verify no retries or partial ready pages. Preserve existing UTF-8, cancellation, deadline, filter and status tests.

## 3. Implementation
Read identity expected length once, validate it as a bounded safe integer, reject overflow while streaming and require exact EOF. For compressed responses ignore wire length for the decoded-byte cap. Keep fatal UTF-8 decoding, cancellation, 15-second deadline and private unavailable result.

## 4. Gates and risks
Run targeted tests, strict typecheck, repository lint/docs checks and npm run check before PR. Require exact-head CI and independent formal approval before merging; parent chain gates also apply. Native loopback Fetch is not a deployed browser, IdP, PostgreSQL or provider E2E. No deployment or paid call.

## 5. Evidence
RED: all three new public-client regressions failed (identity producer stalled, compressed metadata rejected, native level-zero gzip boundary rejected). GREEN: 3/3; combined usage/client and history framing regressions 24/24, zero skip. Strict typecheck, repository lint (existing warnings only), document/contract/fixture-secret checks and diff check pass. Full npm run check invoked before PR; final outcome recorded separately. Native loopback HTTP uses Fetch; synthetic stream/metadata cases are explicitly separate.
