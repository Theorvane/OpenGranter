# Browser usage CSV export transport

## Issue and problem
- Issue: #642 (parent #637). Existing signed-SSO CSV endpoint has no browser transport.

## Scope and expected behavior
- Add an explicit caller-authorized request adapter for one CSV page with principal/model/time/limit/cursor filters.
- Ready results preserve CSV verbatim and opaque continuation; unknown billing is never repriced. Status-only unauthenticated/denied/invalid/unavailable/cancelled outcomes expose no server error text.
- No UI/DOM, download, session, token acquisition/storage, listeners, runtime activation or deployment. Frontend owns view/session integration.

## Design
- Fixed same-origin management path and format=csv; no caller URL/headers. Use GET/no-store/redirect:error with text/csv Accept.
- Bound streamed UTF-8 bytes to 2MiB and reads to 15 seconds, abort on invalidation/new read. Suppress late headers/body, cancel unread/error streams without awaiting untrusted cancellation.
- Strict server CSV content type and x-has-more/opaque x-next-cursor consistency. Reject malformed filters before request; server authorization remains authoritative. Explicit principal filter still requires server ReadAll.
- No new authority, retention, money calculations, audit storage or provider calls.
- Contract: ../../contracts/management-usage-export.md. Existing endpoint: ../../contracts/sso-usage-history.md.

## TDD plan
- RED import missing module. Test actual Fetch adapter CSV and empty output, filters, statuses, continuation headers, malformed/oversized bodies, cancellation and late reads.
- Implement transport only, then typecheck/lint/scripts and standard npm run check; no installed/browser/provider success inference.

## Delivery
- New issue branch and independent PR with exact-head CI and formal approval. Revert/remove adapter to roll back; no database changes.

## Verification evidence
- RED missing module (/tmp/og-0030-export-red.log). GREEN 20/20 zeroSKIP combined CSV client and existing HTTP suite (/tmp/og-0030-export-green3.log). Includes signedJWT + migrated PGlite + real Fetch + SQL history, empty page, inactive human, status/errors, size/UTF8/cursor validation, ignored-abort transport, stalled body and fake-clock deadline. Local integration uses in-memory audit, not durable deployment.
- Full typecheck/lint/planning/offline compatibility and standard fullcheck are separate gates, not inferred from focused tests.
- Full typecheck, lint (existing 42 warnings plus informational diagnostics), planning/link/fixture scan, six offline pins and browser-platform esbuild bundling pass. Standard npm run check launched separately at /tmp/og-0030-export-fullcheck.log; final result must be read.
