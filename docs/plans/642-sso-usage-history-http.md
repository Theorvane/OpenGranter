# SSO usage HTTP integration (#642)

## Issue and problem

Issue #642, parent #637. PR #696 already implements the internal service; do not replace or duplicate it. Its exact approved head 0a1d0de could not merge because it was behind main. Integrate main without bypassing branch protection and add the missing public Fetch adapter.

## Scope and expected behavior

Expose GET /management/v1/usage through a factory, preserving existing service authentication, usage:ReadSelf/ReadAll IAM, filters, keyset pagination, JSON/CSV and mandatory SSO audit. No session/BFF/CSRF decision, runtime mount, database schema, provider call or frontend owner change. Durable SSO audit composition remains open.

## Design

Reuse createPostgresSsoUsageHistory.read(accessToken, requestId, query) exactly. Map its invalid_query to HTTP400, unauthenticated401, forbidden403, unavailable503 and audit_unavailable503. Every response has no-store/nosniff. See ../../contracts/sso-usage-history.md, ../PRD.md and ../acceptance.md.

## TDD plan

Copy the meaningful signed JWT/migrated PGlite/Fetch tests into a new integration file before adding the adapter. RED must fail importing the missing HTTP module. Cover scoped success, JSON/CSV continuation/filtering/empty states, fresh Deny/revocation, malformed query, SQL/cross-principal hidden lookahead, awaited/failed audit and privacy.

## Delivery

Run existing service and new HTTP tests plus dependent tests, typecheck/lint, scripts and full npm run check. Require new exact-head formal approval and required CI after updating #696. The old approval is not approval of this extension. Local Fetch and embedded SQL do not prove browser login, installed PostgreSQL, a real IdP or deployment acceptance.

## Superseded local experiment

Unpublished ae04591 in /tmp/og-20261110-2330 duplicated the service due to checking only main. It was not pushed: non-fast-forward refusal exposed existing #696. Preserve it for diagnostics only; use #696 implementation and its reviewed continuation fixes instead. Results for that experiment do not certify this head.

## Verification evidence

- RED on the actual #696 integration tree: missing `sso-usage-history-http.ts` module (`/tmp/og-2330-http-red.log`).
- GREEN: existing service, new HTTP integration and dependent serial suite **38/38, zero skips** (`/tmp/og-2330-http-suite2.log`), Node v22.23.0/npm10.9.8. New Fetch tests cover the real existing service with registered-key signed JWT and migrated PGlite, not a fake result service.
- Full typecheck and lint passed (42 existing warnings/160 infos). Planning/link/fixture-secret scan, whitespace and six offline compatibility pins passed.
- An earlier attempt ran alongside the superseded experiment full check; typecheck was Killed and three suite files SIGKILL (`/tmp/og-2330-http-suite.log`). The experiment check was explicitly stopped by verified worktree ownership; it never completed and is not PASS evidence. The later isolated 38/38 does not erase those failures.
- Actual integration-tree standard `npm run check` launched separately in `/tmp/og-2330-http-check.log`; its final result must be verified rather than inferred from focused tests. No installed/live/browser/real-IdP acceptance or paid call claimed.
- Existing #696 service and its continuation fixes are unchanged. The prior approval at 0a1d0de does not approve this main integration/HTTP extension; new exact-head formal approval and required CI are mandatory. Base-behind merge refusal was honored, not bypassed with admin/auto privileges.
