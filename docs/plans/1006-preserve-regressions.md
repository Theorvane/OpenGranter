# Preserve distinct regressions during consolidation

## Issue and problem

- Issue: #1006; cleanup tracking: THE-12.
- PR #765 at `db82f7b8c97a5f290cddf69beba96afd83a30701` retains
  stalled invalid-UTF8 body-cleanup assertions absent from current main.
- PR #688 at `a8472dbff3ccbcbabf2ce1540e6102867f278eb0` retains
  signed-JWT, migrated-SQL, actual-HTTP catalog-client assertions. Its
  production implementation is already present in main.
- Keeping these assertions must not restore historical production trees or
  duplicate the oversized-body coverage already in main.

## Scope and expected behavior

- Port only the two issue/revoke invalid-UTF8 cleanup regressions from #765.
  Existing `sso-management-body-cleanup.test.ts` already checks oversized
  issue/revoke rejection, no mutation, reader release and stalled cleanup.
- Port #688's real catalog-client list/detail assertions for success, fresh
  explicit Deny, inactive binding and failed required audit.
- Production behavior, API contracts, permissions, secrets, accounting and
  runtime activation remain unchanged. No deployment or live provider calls.

## Design

Keep current main source and existing test cases, including #767's separate
content-coding regressions after its reviewed integration. Add assertions at
the public Fetch/client and owned HTTP/SQL boundaries. Do not replace whole
historical files. Original source PRs remain open until the replacement is
validated and merged with an explicit assertion-to-coverage mapping.

No new domain terms, product requirements, architecture decisions or ADRs are
needed. Existing PRD/acceptance and contracts describe the tested behavior.

## TDD plan

This is test-only consolidation of already implemented behavior, so no new
production RED/GREEN cycle is claimed. The original source PRs retain their
original evidence. Verify the preserved cases against current main using the
credential Fetch and real signed-SQL catalog HTTP suites; also run existing
body-cleanup cases to substantiate the duplicate-oversize mapping. Run strict
types, lint, planning checks and required full `npm run check` CI. Record exact
commands, results and environmental failures in the replacement PR.

## Delivery

Use an owner-authored issue-numbered branch and PR. Code, issues and PRs use
command-scoped verified `sjungwon03`; independent reviews use only
`sjungwon03-ai`. Never use the company account or another review identity.
The historical #1005 review exception is withdrawn for future actions; keep
its existing audit record intact. No force push or branch deletion.

After fresh exact-head CI and independent review, merge with a matching-head
guard. Close #765/#688 only after checking actual replacement coverage and
linking the merge, rather than treating ancestry as delivery. Keep #7/THE-10
and its new Router PR #1007 outside cleanup. Rollback removes only these test
and plan additions; no production behavior changes.
