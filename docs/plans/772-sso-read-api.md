# Single-listener SSO identity and model reads

## Issue and problem
- Issue: #772; parent #637, bounded #639/#641 integration.
- Separate unbound principal and catalog servers need caller-written dispatch to expose both on one listener. Identity must never be mistaken for catalog authority.

## Scope and expected behavior
- Compose existing principal and model list/detail handlers into one opt-in unbound Node server and Fetch handler.
- Principal retains fresh RFC9068/exact active-human binding and required SQL identity audit. Model reads retain fresh catalog IAM and required SQL catalog audit.
- Unknown paths/methods: no-store 404 without database/authentication/audit work. Existing handlers retain invalid-shape validation.
- No writes, cookies, CORS, session, frontend/runtime changes, migrations, automatic DDL, provider calls or deployment. Caller owns committed/autocommit clients and explicit installation of the proposed identity-audit table.

## Design
1. Capture explicit configuration; select only known fields, never forward supplied auth overrides.
2. Exact principal path and exact catalog prefix dispatch to existing handlers; other paths fail closed.
3. Return unbound Node server with private no-store/nosniff fallback.
- Alternative: modify backend-owned runtime; rejected here to avoid ownership conflict and unapproved activation.
- Dependencies: unmerged #769/#771; not independently mergeable. No new domain terms or ADR decisions. Session/security/installation approvals remain open.
- Contract: contracts/sso-read-api.md; PRD, architecture and acceptance updated.

## TDD plan
1. RED: catalog-only scaffold; actual Node principal HTTP returns 404 instead of 200, not an import/compiler failure.
2. GREEN: exact dispatch with existing principal SQL audit composition.
3. Signed JWT, models/detail, changed IAM versus identity, binding revocation, absent/expired token, audit failure privacy, zero-work unknown paths/methods, captured config.
4. Serial affected suites, typecheck, lint, planning and compatibility; standard npm run check separately, report resource failures distinctly.

## Delivery
- Isolated worktree; no frontend/runtime edits. Include exact HEAD, RED/GREEN and limitations in PR.
- Require dependencies, exact HEAD full CI and independent formal approval before merge. Rollback removes opt-in module only; no active runtime or data changes.

## Verification record
- RED Node22 actual principal request:404 !=200 with catalog-only scaffold; /tmp/og-1900-read-api-red.log. Initial system Node18 lacked strip-types, corrected to existing Node22 before behavioral RED.
- GREEN first integrated scenario:1PASS. Expanded getter regression RED exposed raw diagnostic, then fixed configuration normalization.
- The expired-token test was corrected to use a complete valid claim timeline expired beyond the already agreed60-second tolerance; no verifier/tolerance change. Intermediate exploratory test failure is not claimed as product failure or final green.
- Final serial suites, local standard gate and CI are recorded at delivery; no browser/installed/production claims.

- Final four serial suites:51PASS,0FAIL,0SKIP /tmp/og-1900-serial-green.log. Typecheck PASS; lint no errors (42 existing warnings); planning checker and all6 offline compatibility checks PASS. Native page and desktop both unavailable (screen being released); no browser PASS.
