# SSO usage public response contract (#637, #642)

## Scope and acceptance
1. Repair the existing Bearer-only usage HTTP response boundary, not session acquisition. No schema, policy, listener, production or paid-call changes.
2. A ready response must match parsed request format, requested limit, explicit target, filters and descending shared order. JSON continuation must describe the final displayed row; reject an empty continuing page.
3. Keep authentication and mandatory auditing in the existing reader. Parse the query only after ready, preserving failure precedence and auditing. Self identity remains the authenticated service responsibility.
4. Preserve successful JSON/CSV, exact cursor bytes and unknown costs. CSV body projection remains the trusted service responsibility; transport checks format and forward progress only.

## TDD sequence
1. Add public-handler regressions for format, limit, target, filters, ordering, repeated/mismatched cursors and invalid ready queries. Record RED before production edits.
2. Reuse query/filter/order/record/cursor functions; return fixed no-store 503 without partial rows on invalid ready responses.
3. Run focused existing real loopback SQL tests plus new tests, typecheck, lint, planning validator and full check. Request independent exact-head review and require all CI before any merge.

## Evidence limits
Injected malformed ready results demonstrate response-boundary regressions, not an observed SQL leak or company-login acceptance. Existing SQL+signed-test-token loopback tests are local only. Browser login, installed PostgreSQL, real IdP/provider and deployment remain separate gates.

## Integration repair (2026-11-10)
1. Full local and remote check exposed three invalid mocked service pages in existing UI/client HTTP acceptance: unsorted summary, overlapping next page, and identical input/output cursor. Keep production rejection intact.
2. Correct only those service responses to obey descending order and strict cursor advance; assert displayed page records and absence of overlap while preserving exact summary and filter-clear/CSV behavior.
3. Run both full UI/client files plus response-contract and signed-test SQL loopback tests, then full check. Update the same PR rather than creating another stack layer.
