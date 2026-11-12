# SSO catalog dense list projection

## Issue and problem

- Issue: #641 (parent #637).
- Array.map skips missing elements. Malformed service lists currently return HTTP 200 with null instead of a model, breaking the browser list contract.

## Scope and expected behavior

- Reject sparse service lists as a whole with existing fixed 503 internal_error.
- Preserve dense/empty lists, safe projection, fresh authentication and mandatory audit.
- No session, permission, schema, inference, deployment or paid-call changes.

## Design

- Iterate each list entry explicitly before serialization. Holes become undefined, which existing projection rejects.
- Filtering holes would conceal catalog corruption and is not acceptable.
- References: contracts/sso-model-catalog-http.md; existing PRD SSO catalog requirements and acceptance scenarios. Restore existing behavior guarantees rather than add a product decision.
- No open decisions for this repair. Login/BFF approval remains separate.

## TDD plan

- Public-handler tests: all-hole, leading-hole and trailing-hole service arrays must yield 503 without partial data. Before repair these return 200.
- Retain dense/empty, denial and audit-failure coverage.
- Run focused tests, typecheck, lint, planning checks and npm run check; distinguish local results from CI.

## Delivery

1. Record plan and failing test.
2. Replace skipping map with explicit projection iteration.
3. Clarify contract, verify, commit and request exact-head independent review.
- Rollback: revert isolated patch; no migration or activation.
- Evidence: RED/GREEN and full-check outcomes, PR exact HEAD. No browser/installed/provider E2E claim.

## Execution evidence (2026-11-10)

- RED: focused public-handler test failed with expected HTTP 200 != 503.
- GREEN: test/sso-model-catalog-http.test.ts: 20 tests passed, zero failures/skips.
- TypeScript, lint (existing warnings/information) and planning/link/secret scan passed.
- Full npm run check launched; final outcome must be read from /tmp/og-20261110-2230-check.log and reported separately.
- No browser, installed PostgreSQL, company IdP or provider calls were performed.
