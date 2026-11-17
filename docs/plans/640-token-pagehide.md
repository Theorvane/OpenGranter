# Token administration page-exit cleanup

## Issue and problem
- Issue: #640, parent #637. The shared token panel requires host disposal on navigation, but native page exit can retain the document (including one-time credentials) in the back/forward cache without host navigation cleanup.

## Scope and expected behavior
- Observe the owning document's optional native window pagehide event. Terminally dispose both children, clear live and detached owned inputs/secrets, abort pending waits and remove the observer.
- Restoration does not reactivate this panel or infer session validity. The host must mount a fresh panel with approved authority. Clearing/abort does not revoke a token or roll back a mutation.
- No session, entry, navigation, API, IAM, storage, deployment or provider changes. Non-browser callers without defaultView keep explicit disposal behavior.

## Design
- Change token-management-panel.ts only in production. Use an optional structural lifecycle port from root.ownerDocument, preserving the shared CatalogElement interface and frontend ownership.
- Reuse existing terminal disposal. Register after children exist and remove on explicit disposal or fresh denial as well as page exit. Host still owns expiry, logout and identity changes.
- No new domain terms, authentication contract or ADR decision. See contracts/token-management-pagehide.md, PRD and acceptance additions.

## TDD plan
- Baseline must fail on retained secret nodes, pending request abort and inactive detached controls after pagehide, not missing imports.
- Test issuance success, pending mutation, denial, explicit disposal, repeated page exits, independent roots and null/absent native window. Existing HTTP/auth tests remain required.
- Run focused tests, full typecheck, changed-file lint, document checker, compatibility and aggregate check. Browser fixture evidence is separate from installed SSO/PostgreSQL/provider evidence.

## Delivery
- Isolated issue branch stacked on current reviewed work, signed-off commit and PR. Exact-head CI and independent formal approval required before merge.
- Rollback removes the lifecycle observer; retain explicit host disposal. No automatic retry, token revocation or page restoration grant.
