# Usage browser CSV failure evidence (#642)

## Boundary

2026-11-10 07:30 KST execution, native Chromium through page tools at `http://127.0.0.1:18844`. Production `usage-app.ts` compiled by the existing `buildManagementBrowser` function. Local host forwards a server-only signed synthetic SSO token to the actual `createPostgresSsoUsageHistoryServer`; migrated PGlite contains active human IAM, a usage:ReadSelf policy, pre-registered issuer/subject and three ledger attempts. Test-only host injects browser allocation failure, not a product setting. No company SSO, cookie session, installed PostgreSQL, real provider, paid call or deployment certification.

Harness and sanitized request log remain outside the repository: `og-0730-browser.ts` / `og-0730-browser.log` in coordinator home. The harness derives from the existing usage retry reproduction and uses isolated in-memory storage.

## Actual browser actions and observations

1. Initial actual API list renders three rows with unknown usage/cost, not fabricated zeros. Submit Request ID `req+1` and page size `1`: first page time `.003Z`.
2. Next page renders `.002Z`. Host starts with `URL.createObjectURL` throwing a private browser error. Click Export current page CSV: UI leaves Preparing CSV and renders safe Usage unavailable, Retry current page, no records/details/download/CSV text or exception string.
3. Enter unsubmitted Request ID `unsubmitted-draft`, enable Recover CSV allocation (test host), click Retry current page. UI restores `.002Z` with submitted `req+1`, page size1 and Previous page; draft is not consumed.
4. Export again: Download usage.csv appears. Click the native link; browser reports `Downloads/usage.csv`, 573 bytes, text/csv. Read the file: header plus exactly attempt-2 / req+1 / human / chat / occurred_at_ms2. Missing usage and costs are empty, not fabricated. Export is one page; more records remain.
5. Previous page returns `.003Z` and removes the prior CSV download.

## Request evidence

The failed CSV and retry list both used the exact opaque cursor `WzMsImF0dGVtcHQtMyJd` with request_id=req%2B1 and limit=1. Successful second CSV used that same cursor; previous navigation omitted cursor and retained submitted filters. No request used the unsubmitted draft.

## Automated evidence

New public mount regressions reproduce unhandled allocation rejection and revocation-interrupted cleanup before the fix. GREEN covers private failure/retry over actual HTTP and throwing revocation with blocked detached click/auxclick/contextmenu plus renewed authority. Combined new/existing UI, recovery and source/compiled SQL HTTP integration suites: 49 passed, 0 failed, 0 skipped. This automated revocation fault is not a native-browser revocation-failure claim. Full standard check and remote CI are reported separately in the PR.
