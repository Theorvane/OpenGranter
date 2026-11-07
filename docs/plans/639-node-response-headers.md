# Isolated management transport response headers

## Issue and problem
Issue #639, parent #637. The Node adapter stages normal response headers before it knows the response can be serialized. A pre-commit failure can leave cookies, redirects or framing attached to the safe error envelope.

## Scope and expected behavior
Validate normal status and all headers before staging. On pre-commit failure remove all staged headers before preparing the existing fallback. Preserve successful streaming, fixed errors and mandatory privacy. No authentication, session, authority, database, runtime activation or paid calls.

## Design
Keep the boundary in node-request-server.ts. Validate then stage, clear uncommitted headers in catch; never buffer successful streams. Committed-response destruction is unchanged. Session/CSRF/CORS/ingress remain unresolved. See PRD and acceptance.

## TDD plan
Reproduce invalid status/header and consumed body over actual loopback HTTP; fixed errors must not contain old cookies, location, encoding, framing or private headers. Verify survival and valid headers. Run RED before source, GREEN, typecheck, lint, planning checker and full check.

## Delivery
Independent exact-head formal approval and all required CI before merge. Rollback only this adapter change. Socket tests are not browser login, installed PostgreSQL, deployment or provider acceptance.

## Execution evidence

RED: 2 failed, 2 passed; invalid header and consumed-body responses leaked a-private over actual HTTP. GREEN: 23 passed, zero failed/skipped across five socket regression files after source changes. Full checks and exact-head review/CI remain required.
