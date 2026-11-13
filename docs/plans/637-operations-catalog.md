# Models in trusted management operations

## Issue and problem
- Issue: #637; related #639, #641, #642. Trusted operations lacks navigation to the existing SSO model list/detail.

## Scope and expected behavior
- Add Models navigation using existing SSO catalog transport and DOM renderer. Preserve History as initial view. Reuse list/detail, loading, empty, missing, unavailable and retry contracts.
- Dispose prior content and abort pending work on navigation. Detached controls cannot send requests or revive old data. Current 401/403 terminates operations; old denials cannot affect current views.
- No authentication source, public entry, cookie/CSRF decision, IAM changes, writes, provider calls, persistence or deployed acceptance. Existing trusted-caller and expiry obligations remain unchanged.

## Design
- New operations-catalog.ts coordinates createSsoManagementCatalogSession and renderCatalogView. Compose in operations-app.ts without changing frontend-owned entry/catalog files.
- Reuse bounded parser rather than duplicate HTTP logic. Server authentication and audit remain authoritative. No new domain terms or irreversible decisions.
- Contracts: contracts/management-operations.md; docs/PRD.md, docs/architecture.md, docs/acceptance.md.

## TDD plan
- Existing operations first fails Models navigation behavior assertions, not missing imports. Cover SSO GET paths, list/detail/loading/empty/error/retry, abort, stale controls, current/stale denial and canonical browser bundle.
- Implement minimal coordinator; run focused tests, TypeScript, Biome, planning, compatibility and attempt full check.

## Delivery
- Separate issue branch/worktree, DCO and AI disclosure. Require exact-head CI and formal approval before merge. Rollback removes navigation without migration. Synthetic and installed evidence remain separate.

## Verification checkpoint
- Baseline operations mount: 0/6 pass, six behavior failures for missing navigation/bundle content. Implemented coordinator: 9/9 new cases pass; focused operations/session/SSO catalog regression 53/53 pass, zero skipped.
- Broader management run: 485/486 pass, zero skipped. The sole CLI artifact test fails because installed npm cannot load walk-up-path; aggregate npm run check fails before repository scripts for the same reason. No full-suite success claim.
- Direct full TypeScript and Biome exit successfully; planning links/contracts, six compatibility pins and diff whitespace checks pass.
- Native browser local preview at http://127.0.0.1:18813 with explicitly synthetic responses: History to Models list, model detail, Proxy tokens, Models, simulated logout to Sign-in required. Canonical builder used; preview entry removed before commit. This is not an externally accessible deployment URL or real SSO/API/provider acceptance.
- Public entry, session acquisition, other owners files and PR911 stream cleanup are unchanged. Actual trusted-session source and installed activation remain integration dependencies.
