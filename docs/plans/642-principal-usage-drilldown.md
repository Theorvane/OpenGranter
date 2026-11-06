# Principal usage API drilldown (#642)

1. Add a guarded action to each usage row principal cell. Request the existing scoped usage API for that exact principal; retain submitted model, UTC bounds and size, reset cursor/history, draft edits and CSV continuation. This is server filtering, not page-only filtering.
2. Reuse existing render/authority guards and client validation. Never broaden policy, session, content retention or installation. A principal label is not a grant or a principal-directory navigation capability.
3. First extend source/artifact contract tests for exact unsafe identifiers, retained scope, stale controls, loading, revoked CSV, expiry, denial and late completion. Extend signed-SSO HTTP/database/IAM/audit integration with a real principal-filter request. Record meaningful RED then GREEN.
4. Run focused and full checks, open a stacked PR and request independent exact-head review. All ancestor and exact-head CI/formal approval gates remain mandatory. Native browser, session and installed acceptance remain separate and open.

## Evidence

- RED: source/artifact principal actions missing, 2 failures and existing model cases 2 passes.
- GREEN: focused usage screen/client/model/drilldown/signed-SSO integration suite 63 passed, zero failed/skipped. Type checking passes after adding the explicit audit-query row type.
- Real signed SSO HTTP + migrated PGlite + fresh IAM: ReadSelf-only explicit self selection is denied and audited with zero records; test-only scoped ReadAll transition then permits principal-filtered read. The client never retries with a weaker scope. Candidate audit schema is not installed DDL.
- Full check is running; exact-head CI/review and native browser/session/install acceptance are not yet established.
