# Canonical model publication discovery

## Issue and problem
Issue #992; parent #637/#641. Canonical PR991 lacks existing PR952 textual publication discovery and PR964 publication filters. Reuse those implementations rather than create competing UI.

## Scope and expected behavior
Only canonical catalog-view.ts, a pure publication helper and tests/docs. Search authorized ID/publisher/name/description and intersect exact published input/output/parameter labels. Unknown/empty metadata offers no filter choices. Render metadata safely as text; empty description is explicit. Filtering is local, never extra authority. Fresh detail/refresh still uses the existing server boundary. Clear retired controls and invalidate stale handlers on rerender. Preserve canonical detail projection and navigation. No session/runtime/DDL/entry/activation, new APIs, credentials, IAM or deployment.

## Design
Port PR952 list behavior and PR964 exact publication filters, not their stacked model-detail implementation. Keep current canonical detail renderer. Controls live for one render only. No new domain terms, costly decisions or ADRs. Related contracts: contracts/canonical-model-discovery.md. Source PRs remain separately owned and not wholly superseded; peer ownership acknowledgement unavailable through non-transferring messaging tools.

## TDD plan
Import existing source public DOM tests plus metadata text/search tests, adapted to canonical fixture names only. Run RED against unchanged canonical production code. Cover combined selectors/search, safe exact future labels, unknown/empty, retired controls and real loopback fresh Deny/detail/refresh. Implement minimal ports; run focused catalog and canonical HTTP suites, strict types/lint, docs, pins and browser bundle, then attempt npm run check. Distinguish native browser from structural DOM tests and embedded PostgreSQL from installed deployment.

## Delivery
Stack explicitly on PR991; retain parent gates, independent formal approval and exact-head CI. Rollback removes this local presentation port. No source PR closure or full product completion claim.

## Execution evidence — 2026-11-22 10:30 KST
Final unchanged-canonical baseline RED:1PASS8FAIL; restored production source then focused GREEN9PASS0FAIL0SKIP. Serial regression256PASS0FAIL0SKIP across catalog/SSO/public DOM and existing actual HTTP/signed synthetic SSO/migrated PGlite cases. New mounted test initially used a noncanonical publisher and was rejected correctly by existing SSO decoder; fixture corrected to opengranter without weakening production validation. Full strict single-threaded TypeScript, full lint, planning/secret scan, pinned compatibility and production catalog-app browser bundle pass. Initial TypeScript flag --singleThread was unsupported; corrected to --singleThreaded. Native Chromium observed2026-11-22T01:35:31.688Z remains Aw Snap error9; no restart, new deployment URL, native browser acceptance or live calls. First asynchronous aggregate check overlapped a temporary RED baseline restore; its partial output is not acceptance evidence. No aggregate success claimed; final immutable-source check is reported separately. Exact-head independent approval and parent gates remain.
