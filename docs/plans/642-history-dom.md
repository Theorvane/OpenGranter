# History management DOM integration

## Issue and problem
Refs #642 and #637. The shared authorized usage/audit workspace has no visible screen that connects filters, paging and CSV. Administrators cannot operate these existing boundaries through a DOM adapter.

## Scope and expected behavior
Add an explicit history DOM mount using an already trusted SSO request port. Show usage and audit tabs, principal/model/time filters (inclusive from, exclusive to, Unix milliseconds), audit request filter, page navigation, loading/empty/error states and one-page CSV actions. Present estimated and provider-reported costs separately as exact strings, missing usage and possible duplicates. Never render arbitrary audit details.
No login, session acquisition, public entry activation, new permissions, persistence, provider calls or deployment changes. The trusted caller must dispose on logout/expiry/identity change. A fresh 401/403 clears both histories through the existing workspace and disposes download leases.

## Design
Use createHistoryWorkspace and an injected download lease port compatible with createCsvDownload. Native labeled controls and textContent only. Teardown and terminal denials invalidate retained DOM handlers; export completion must check the current workspace epoch before saving. Existing server authorization/audit remain unchanged. No new domain terms or irreversible decisions. Session/CSRF/IdP integration remains open.
Links: docs/PRD.md, docs/architecture.md, docs/acceptance.md, contracts/history-dom.md.

## TDD plan
First add mount/action DOM tests; missing module is expected RED. Then cover tab/filter paths, next/previous, CSV, empty/error/retry, unsafe text, exact cost metadata, denial and disposal including retained controls and late exports. Run focused suites, Biome, TypeScript, planning checker, compatibility and npm run check; report resource/tool failures separately.

## Delivery
Implement only new history-app.ts and tests/docs, preserving frontend catalog/entry ownership. Verify through structural DOM ports and real local browser bundle if available. Request exact-head review and require all CI plus formal approval before merge. Rollback removes opt-in mount; no schema/runtime activation. Installed company SSO, PostgreSQL and browser acceptance are separate gates.

## 2026-11-13 download-delivery review correction (before code)
Formal review of PR #908 identified successful CSV reads followed by silent browser-adapter failures. Preserve CsvDownloadResult at the injected port; only started means initiation, never filesystem completion. Add per-tab generic retryable CSV error for unavailable/invalid/disposed or thrown save, without raw diagnostics. Clear the delivery error on explicit retry; do not replace denial/disposal screens or expose failures across tabs. Test all returned failures, throws, retry, success, tab isolation and reentrant disposal before implementation. No session, permission, runtime or deployment change; exact-head CI and fresh formal approval remain required.

Verification: corrected valid CSV-response fixture (required x-has-more header), then four returned/throw cases fail specifically on missing CSV alert (11 pass / 4 fail). GREEN: 15 DOM cases and expanded 63 focused DOM/workspace/review/download cases pass, zero skips. Full TypeScript, changed-file Biome, planning checker, six compatibility pins and diff checks pass. Native browser on loopback synthetic preview18795 shows first save unavailable alert and second started clears it; no filesystem completion or installed SSO claimed. Aggregate npm check cannot start: installed npm permission denied; CI mandatory.
