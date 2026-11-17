# Published catalog detail transport (#641)

1. Preserve only already-published optional name, description and context_length in the authorized catalog client list/detail projection. Do not change the SSO basic metadata publication contract, authentication or routes.
2. Validate supplied fields using existing discovery bounds: nonblank name <=256 characters, description <=8192 characters, context null or nonnegative safe integer. Preserve unknown null, zero and omission distinctly. Text remains inert data, never HTML.
3. Demonstrate failing transport tests before source changes, then implement explicit known-field projection. Exercise actual local gateway sockets for managed/delegated discovery with fresh Deny and mandatory audit, never provider execution.
4. Run catalog regressions, typecheck, lint and contract scan; request independent exact-head review and CI. No browser rendering, company SSO, installed database, paid calls or deployment acceptance is claimed.

## Evidence

Before implementation, all three dedicated tests failed: detail/list dropped the published fields, unknown context was lost and malformed supplied metadata was silently accepted. The existing price socket test's private-published-name exclusion is intentionally narrowed: names are public metadata on this rich API; canonical slugs, upstream IDs and pricing adjustments remain excluded. Basic SSO rows remain basic and unchanged.

After implementation: all 79 catalog tests passed with zero failures/skips, including real loopback managed/delegated HTTP and fresh Deny/audit checks. Typecheck passed; full lint returned zero errors (existing 42 warnings/155 infos); planning/contract scan and all six pinned schemas passed. Full local suite and native browser rendering were not run.
