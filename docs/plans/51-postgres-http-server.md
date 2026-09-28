# PostgreSQL Gateway Node HTTP Server

## Issue and problem

- Issue: [#51](https://github.com/Theorvane/OpenGranter/issues/51)
- The PostgreSQL composition and Node HTTP bridge exist separately; the bridge cannot accept an already-composed handler.

## Scope and expected behavior

- Add a reusable Node request-handler bridge, preserve `createNodeChatServer`, and expose `createNodePostgresChatServer` using the PostgreSQL composition.
- Return an unbound server; the caller owns listen/close and database connections. Preserve existing HTTP/authentication/audit/accounting semantics.
- Out of scope: production connection provisioning, CLI startup, TLS, reverse-proxy settings, SSO, and management mutations.

## Design

- Move existing socket adaptation into `createNodeRequestServer`. Compose both old and PostgreSQL factories through that bridge.
- Test real local HTTP requests with embedded PostgreSQL, migrations, issued tokens, a stored ordered route, and a registered OpenAI adapter with a fake upstream transport. Inspect persisted history and revoke the token before a second call.
- Update [architecture](../architecture.md), [PRD](../PRD.md), and [acceptance](../acceptance.md). Existing HTTP contracts remain unchanged.
- Open decisions: deployment process, TLS, production infrastructure, and graceful shutdown policy.

## TDD plan

- First write a socket integration test importing the PostgreSQL server factory; expect the module to be absent.
- Assert model visibility, native adapter endpoint, attributed usage/audit, no metadata content or token leakage, and no inference after revocation. Keep existing socket tests green.
- Implement the bridge extraction and factory, run focused tests, then `npm run check`.

## Delivery

- Use `feat/51-postgres-http-server`, authorized DCO/assistance trailers, and a ready PR linked to the plan and issue.
- This tests composition over a socket; it does not certify a production deployment. Tests explicitly close the server and database.
