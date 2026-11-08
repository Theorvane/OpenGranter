# Audit attribution integrity (#637 / #642)

1. Reproduce malformed sparse and duplicate policy attribution accepted by the actual SQL writer. Assert rejection before clock/SQL, not merely a downstream schema error.
2. Validate a dense, own-indexed, unique-policy snapshot while retaining allowlisted copied values and legitimate empty snapshots. No identity grants, schema installation, runtime activation or UI changes.
3. Run the real SQL store, HTTP regression tests, typecheck, lint and scripts. Request exact-head independent formal review and CI before any merge.

Acceptance: sparse, inherited-index, duplicate-ID and null-entry policy arrays fail with fixed InvalidSsoAuditHistoryAccessEvent before side effects; distinct policies and empty authenticated snapshots still append with awaited acknowledgement. Local SQL/HTTP evidence is not browser SSO or installed PostgreSQL durability.
