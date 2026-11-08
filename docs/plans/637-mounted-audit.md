# Mounted audit workspace (#637, #642)

1. Add a failing host navigation test before production changes.
2. Reuse the bounded current-principal HTTP reader; return only its validated ID to trusted composition, never treat identity as permission.
3. Mount audit list, UTC/principal/model filters, cursor navigation and page-scoped CSV as text in the actual workspace. No automatic file download or content retention.
4. Clear all private DOM on navigation, expiry, denial, renewal, pagehide and disposal; detached controls cannot dispatch.
5. Test API paths, filter/cursor replay, loading/empty/error, principal isolation and lifecycle races; compile the actual public entry. Node DOM-port evidence is distinct from native browser and installed acceptance.
6. Run checks, submit exact-HEAD PR and request independent formal review; never merge without all required CI and approval.

No session/CSRF/DDL/provider/paid-call changes. Approved grant source and native login remain separate integration gates.

## Evidence

- RED: three host tests failed because actual workspace had no Audit control (local red log).
- GREEN: 94/94 sequential targeted tests, no skipped tests; includes actual compiled workspace execution, public-entry build, bounded /me identity, audit client/workspace and existing loopback HTTP adapter. Initial filtered fixture was corrected to a model-bearing canonical event with descending cursor IDs; no validator was relaxed.
- Actual public bundle: 123309 bytes. Native browser access and desktop observation both failed with screen-release HTTP 500; no native UI or running-URL claim.
- Full TypeScript, lint, planning/contract checks and offline compatibility checked separately. No installed PostgreSQL or live provider calls.
