# Confirmed proxy-token issuance panel

## Issue and problem
- Issue: #640, parent #637. Existing SSO issuance HTTP API has no independent native management panel.

## Scope and expected behavior
- Reuse POST /management/v1/proxy-tokens with principalId and nonnegative integer expiresAt (Unix milliseconds). Server alone enforces lifetime/authorization/audit.
- Require review and explicit confirmation; show credential ID and bearer token only after validated 201. Clear removes displayed value and prevents stale-handler redisplay. No clipboard, persistence, logging, URL secrets, or automatic replay.
- Caller owns approved authorized request port, logout/identity disposal and navigation. No session, CSRF, IdP, DB or policy decisions; no provider calls.

## Design
- Add token-issue-client.ts and token-issue-panel.ts; retain existing revocation and canonical FE ownership.
- Exact bounded JSON result, safe status labels and no private error rendering. Network/malformed/server failures are uncertain and may have committed. Clearing/abort never revokes a credential.
- Separate input/review/pending/result states; stale handlers, duplicates and late asynchronous results cannot redisplay credentials. Fresh 401/403 terminal-lock the panel.
- Reuse current CatalogRequest/CatalogElement contracts. No new domain terminology or costly architecture decision. Contract: [token-issuance-panel](../../contracts/token-issuance-panel.md). Native browser and installed session acceptance remain open dependencies.

## TDD plan
- First public tests against unavailable/no-op implementations must fail assertions (not imports). Cover exact payload, expiry and Unicode ID validation; 201 parsing, denial, invalid lifetime, uncertainty, oversized/invalid UTF-8 and cancellation.
- Public panel tests cover confirmation/cancel, secret clear, stale callbacks, duplicates, terminal denial and dispose; SSO handler integration covers exact actor/request/payload and error mapping.
- Focused regression, TypeScript, Biome, planning/contracts/links/scans, six offline pins; attempt aggregate check without repairing unrelated toolchain.

## Delivery
- Isolated issue branch and PR. Require exact-head CI and independent formal approval before merge.
- Evidence distinguishes controlled ports/native component tests from browser/installed/live acceptance. Rollback removes additive component, not already issued credentials.

## Execution evidence
- Node22 unavailable/no-op baseline: 9 assertion failures, 1 pass, zero skips (/tmp/og-1800-red.log); no import failure. Implemented client/panel: final 12 new tests plus existing token management/revocation/SSO public tests: 120/120 pass, zero skips (/tmp/og-1800-regression-final.log). Separate prior regression including lifetime caps: 136/136 pass, zero skips.
- Full TypeScript pass; changed-file Biome clean; full Biome zero errors, 42 existing warnings and 175 infos. Planning/contracts/links/fixture scan, all six offline schema integrity checks, diff check pass. Aggregate npm run check could not start because pre-existing npm lacks walk-up-path; not repaired and not represented as aggregate green.
- Native Chromium component acceptance at http://127.0.0.1:18860: real DOM labels/inputs, review/cancel left synthetic request count zero; confirm incremented once and displayed synthetic result; clear removed result and kept count one. Browser port returned synthetic Response only: not a real authenticated API, IdP, installed PostgreSQL or live issuance result. External acceptance remains open.
