# Catalog DOM application (#639, roadmap #637)

## Issue and problem

The canonical catalog client, session and authority have no committed browser DOM entry. This delivery exposes their existing states through native DOM controls without inventing browser authentication.

## Scope and expected behavior

Mount `src/management/catalog-entry.ts` into `#app`; show sign-in required without a grant. Render loading, list, empty, detail, missing, unavailable, denied and expired states. Use textContent for remote values and native buttons for keyboard activation. Dispose on pagehide. No storage, authentication globals, default fetch, token handling, transport duplication, or production activation.

## Design

`mountManagementCatalog(root)` returns authorize(grant), clear(state), and dispose(). The trusted caller supplies the canonical CatalogAuthorityGrant (request port plus epoch-millisecond expiresAt); server authentication and IAM remain mandatory on every request. Canonical authority onChange drives rendering, expiry and stale-result suppression. View-only structural DOM ports preserve the existing server-only TypeScript library configuration. Use the merged #672 builder, not the earlier local experimental builder.

Open dependency: the backend/architect must select the real browser-session grant and logout bridge. The public entry intentionally cannot show authenticated catalog data. No new domain or authorization decisions are made; existing catalog contracts remain unchanged. HTTP/bootstrap composition belongs to separate changes.

## TDD plan

The app and view tests were prepared alongside existing local implementation; historical red evidence is not independently re-established in this delivery. Test protected-data removal, text-only output, native actions/focus, trusted list/detail, expiry, logout/disposal races and 401/403/404/500. Add an entry-artifact regression before integration: bundle the actual entry and check signed-out mount, zero network, missing root and pagehide teardown. For new regression red evidence, temporarily omit the entry in an isolated working-copy check and restore it before green execution; do not claim historical app red evidence.

## Delivery

Preserve earlier local builder outside the worktree; fast-forward to merged main and build the actual entry using `npm run --silent management:build -- src/management/catalog-entry.ts`. Run focused tests, typecheck, lint, full check and a real browser smoke where available. Report commands/results and unverified session/provider acceptance separately. Rollback removes the new opt-in UI files without changing canonical client/session/authority or HTTP runtime.
