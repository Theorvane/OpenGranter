# Require valid durable gateway audit acknowledgements

## Issue and problem
- Issue: #780; refs #637 / #639 / #640.
- The common gateway SQL audit store treats every one-element rows array as persistence acknowledgement, including sparse arrays, empty objects and invalid event IDs. Management authentication denial can therefore proceed without a valid required storage acknowledgement.

## Scope and expected behavior
- Change only the existing common audit store and its focused acceptance tests.
- Require an own rows array, exactly one own object row and an own positive PostgreSQL bigint event_id. Accept canonical decimal strings within signed bigint and positive safe integer numbers, matching existing pg/PGlite drivers.
- Reject malformed results as fixed GatewayAuditUnavailable. Preserve projection, parameterized INSERT, DDL, permission and session/runtime defaults. No retries or exactly-once guarantee.
- Existing management HTTP maps failed denial audit to 503 audit_unavailable, not ordinary 401. No secrets or driver errors in responses.

## Design
Validate the result after the existing awaited INSERT. Do not coerce arbitrary values or alter SQL result representation. The acknowledgement does not certify a caller-owned transaction commit; committed/autocommit SQL remains required.
No schema, listener/session decisions, deployment or provider activation. Base is exact #779 9a7e90f; stacked dependencies remain unmerged and need fresh review/CI on adoption.

## TDD plan
1. Reproduce malformed acknowledgements through public append and an actual loopback management HTTP server before production changes.
2. Cover sparse/inherited/malformed result fields, bigint limits, safe integer/string success and awaited pending persistence.
3. Test valid acknowledgement retaining 401, malformed acknowledgement producing sanitized 503 and no issue/revoke invocation.
4. Run focused tests, typecheck, lint, documentation checks and standard check; distinguish local/CI/native-browser/installed evidence.

## Delivery
Issue-numbered branch and draft PR with exact-head CI and independent formal approval. No merge of unapproved dependency stack. Reverting restores old acknowledgement handling; no migration or data changes.
