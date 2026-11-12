# Explicit history CSV file download

## Issue and problem
- Issue: #642, parent #637. Authorized CSV clients return bytes but do not save files. Browser users need an explicit file-download adapter without new session authority.

## Scope and expected behavior
- Caller-owned DOM/object-URL adapter for one already-authorized usage/audit CSV page. Only an explicit save call creates a file. Preserve server CSV bytes, formula hardening and pagination scope; do not reconstruct rows or combine pages.
- Fixed filenames opengranter-usage-page.csv / opengranter-audit-page.csv; text/csv UTF-8 Blob. Existing 2MiB client maximum. Never include identities, filters or untrusted filenames.
- No authentication, fetch, permissions, storage, runtime activation, automatic downloads or full-history claim. Dispose on logout/known expiry/identity change. External downloaded files cannot be erased.

## Design
- New management/csv-download.ts and tests; FE-owned files untouched. Inject DOM, URL and deferred-cleanup ports. Anchor removed immediately; object URLs tracked until cleanup/dispose. Safe failure states without CSV diagnostics.
- Defer URL revocation until after click, rather than synchronously revoking the download. Reentrant disposal prevents later click; cleanup idempotent. Native browser download completion is not observable through this adapter; result means started only.
- Session/CSRF/IdP/navigation remain external dependencies. No domain/ADR decision. Contract: ../../contracts/management-csv-download.md; update PRD/architecture/acceptance.

## TDD plan
- Baseline unavailable adapter represents current absent download behavior. Assertions must fail for Blob bytes/click/cleanup, not missing imports.
- Both histories, Unicode/empty CSV, byte bound, invalid kind, throwing ports, cleanup, reentrancy, terminal disposal and canonical bundled execution.
- Focused tests/regressions, full TypeScript, changed-file Biome, planning and npm run check; full exact-head CI and formal approval before merge.

## Delivery
- Separate worktree/PR, DCO and assistant disclosure, red/green evidence. Rollback removes additive adapter; no persisted mutations. Native downloaded-file verification is separate from DOM-port and bundle tests.

## Verification checkpoint
- RED: baseline unavailable adapter, 0 pass / 5 behavioral failures / 0 skipped. Reentrant append regression: 12 pass / 1 behavioral failure / 0 skipped, then fixed late-connected anchor cleanup.
- GREEN: 15/15 focused including canonical built download/workspace modules, real owned HTTP with signed fixture JWT/current persisted IAM/migrated PGlite/durable access audit, exact CSV bytes through actual Node Blob URLs, revocation and retained-save blocking after Deny. Not native browser evidence.
- Expanded focused regression: 64/64 pass / 0 skipped. Builder-inclusive run: 71/72 pass; one existing npm-spawn CLI case cannot start (null exit status). No skipped/masked test or full-suite pass claim.
- Aggregate npm run check fails before scripts with npm executable Permission denied. Full TypeScript and planning checks pass. Native document typing with explicit HTMLAnchorElement generic verified using DOM typings after a structural-port assignability RED. Native Chromium remains Aw Snap error9; no native downloaded-file completion or installed E2E claim.
