# Explicit usage CSV page continuation (#642)

1. Extend the existing usage view only; preserve trusted grant, IAM, audit and installed activation boundaries. Do not change frontend entry, runtime or migrations.
2. RED: demonstrate that a successful CSV response with an opaque next cursor cannot currently be continued in the UI.
3. Add an explicit next CSV page action. Carry the exact returned cursor and the same filters; never synthesize cursors, auto-download, aggregate unbounded data or treat JSON pagination as CSV authority.
4. Revoke each prior object URL before exporting another page. Clear the chain on filters, list navigation, cancellation, expiry, denial, logout and disposal; late responses cannot restore it.
5. Keep JSON page/history independent from the export cursor. Restart export from the visible JSON page with the existing action. Each CSV page is a fresh server-authorized/audited request; label downloads as individual pages.
6. Verify continuation, exact cursor transport, exhausted pages, restarted export, filter invalidation, denial and pending cancellation using structural DOM and HTTP where possible. This is not native browser, installed SSO or provider acceptance.
7. Run focused tests, TypeScript, lint, planning contracts and CI; request independent exact-head review. No merge without formal approval and required CI success.

## Evidence

- Pre-implementation RED: existing 24 tests passed; two added tests failed on missing Export next CSV page (/tmp/og-0100-csv-red.log).
- GREEN: focused usage app/client and shared workspace 42/42 passed, zero skips (/tmp/og-0100-csv-final-focused.log). Three new test cases cover multi-page exact opaque cursors and exhaustion, URL revocation/restart, 403, abort-insensitive late completion, filter changes and retired controls. One uses actual loopback HTTP with a service stub; it does not certify real IAM/audit for the new continuation behavior. Existing signed workspace tests remain separate regression coverage.
- Initial TypeScript validation exposed nullable signal and unchecked array indexing in added tests; corrected tests, not production authority. Final typecheck, full lint, planning/links/contracts/fixture-secret scan and diff check passed.
- Team Computer screen remains unavailable (500, screen still being released); no native browser acceptance or screenshot is claimed. Full check and exact-head CI/review remain separate gates.
