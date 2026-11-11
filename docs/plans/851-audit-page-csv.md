# Audit metadata page CSV projection (#851)

## Problem and scope
#642 needs a downloadable metadata page without duplicating transport or retaining audit content. Compose the existing authorized JSON audit client with the existing metadata-only CSV serializer. This is local CSV projection, not a server CSV request or whole-history export.

## User-visible behavior
Read one explicit-principal page with model/time/limit filters and an exact decimal continuation. Return CSV, media type, hasMore and nextCursor only after complete validation. Empty pages return a header. No automatic traversal or download.

## Permission and audit impact
The injected request port is already authorized; the server still evaluates audit:Read and records the existing JSON read audit. No new credential, permission, runtime, session, retention, or audit event kind. Host must invalidate and remove displayed/downloaded data on logout/expiry/identity change. No authentication assertion is made by this client.

## Contracts and tests first
Add contracts/management-audit-export.md. Test safe CSV parity/redaction/formula escaping, exact IDs, empty headers, input mutation during await, supersession/invalidation, invalid query, denial and malformed/error responses, and the real Fetch gateway boundary with required read audit failure. RED must fail due to the missing new module; GREEN must exercise the public client.

## Implementation
1. Snapshot scalar query fields synchronously, then read via createAuditHistoryClient.
2. Preserve private non-ready states; serialize the fully validated owned page using serializeAuditCsv and the snapshot.
3. Reuse underlying cancellation/deadline/body bounds; do not retain output or add a cache.
4. Run targeted and full checks; submit stacked on #847 until dependency merges. Require exact-head CI and formal independent approval before merge.

## Risks and unresolved decisions
Browser download/nav integration remains frontend-owned. #847 is an unmerged dependency. Browser SSO/session/CSRF approval, installed PostgreSQL and live provider acceptance remain separate. This work does not resolve those gates or #637 as a whole.

## Execution evidence (2026-11-11 10:00 KST)
- RED /tmp/og-1000-red.log: the new public module is absent (ERR_MODULE_NOT_FOUND), no pass claim.
- First implementation run failed three cases because the proposed =formula request identifier is invalid under the existing metadata contract. Corrected the successful fixture to a valid identifier and added explicit rejection for the invalid formula-like identifier; no validation relaxation.
- GREEN /tmp/og-1000-green-final.log: 25/25 zero skips across new export8, existing metadata14 and CSV3, including Fetch gateway success/Deny/mandatory-audit failure and migrated embedded SQL continuation/revocation. Authentication in these tests is an injected gateway boundary, not live IdP.
- Browser-platform esbuild bundle succeeds (22.6 KiB). This demonstrates dependency portability only, not browser execution/download. Full standard check and independent exact-head approval remain separate gates.
