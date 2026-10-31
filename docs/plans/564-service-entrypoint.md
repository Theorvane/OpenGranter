# Explicit gateway service entrypoint

## Issue and problem

- Issue: #564
- Operators have owned PostgreSQL runtime functions but no executable service command. Current runtime drains HTTP and then closes PostgreSQL, without process signals or a deadline.

## Scope and expected behavior

- Add `npm start` for the persisted dual-route gateway, with validated host, port, shutdown deadline and absolute deployment-owned bootstrap module path.
- Require an explicit factory supplying database, secret and limit ports; never invent allow-all limits or credentials. Keep existing IAM, audit and usage boundaries.
- Handle SIGINT/SIGTERM once, including signals during bootstrap/startup. Drain within the configured deadline; force process exit with failure on timeout. Emit only fixed operational messages.
- Out of scope: container/system-service manifests, readiness endpoints, SSO listener, configuration CRUD, secret-manager vendor choice, real quota enforcement and Jev decisions.

## Design

- Executable parses deployment environment before dynamic import. A trusted absolute module exports `createGatewayPorts`; a public service runner composes the existing dual-route runtime and process lifecycle.
- Bind defaults to loopback; process owns host, port, clock and request IDs. Validate required functions at the dynamic module boundary.
- Prefer an explicit deployment module to opaque JSON containing secrets or a permissive built-in limits policy. Module code is trusted and not sandboxed; extra resources remain its responsibility.
- Unresolved product choices remain unresolved; this is an execution adapter, not turnkey production packaging.
- See [architecture](../architecture.md), [acceptance](../acceptance.md), [service contract](../../contracts/gateway-service.md) and [deployment guide](../guides/service.md).

## TDD plan

- First run service boundary tests before the module exists; expected module-not-found failure.
- Cover configuration rejection before import, missing factory/ports, success, bootstrap/start/close errors with redacted diagnostics, signal races, repeated signals and deadline expiry.
- Implement the smallest runner and executable; preserve runtime cleanup ownership.
- Run focused tests, formatting/type checks and `npm run check`. Also smoke-test the actual executable through a child process.

## Delivery

- Issue, branch and this plan precede code. Add tests, runner, executable and documentation, then open a ready PR.
- Rollback: remove executable invocation; existing public runtime functions stay unchanged. Deadline expiry may interrupt accounting; it does not certify cleanup.
- Red: the initial service boundary test failed with ERR_MODULE_NOT_FOUND before implementation. The actual hung-bootstrap CLI test then failed with exit13 rather than exit1; a referenced lifecycle keepalive corrected this Node top-level-await behavior.
- Green: all 11 new boundary/process cases passed in the integrated test run. The isolated real dual-route/PGlite socket test passed, including unauthenticated401 and database closure on SIGINT. npm start without bootstrap fails safely.
- Type checking and lint passed under taskset -c 0 with GOGC=20 and GOMEMLIMIT=256MiB. Planning/link/contract/fixture-secret checks and git diff --check passed.
- Full npm run check was attempted: the first constrained foreground run exceeded the command window; a detached full run encountered SIGKILL in existing postgres-anthropic-stream tests under the 2GiB shared cgroup. Unconstrained compiler runs were also killed. No assertions or deadlines were weakened; full-gate success is not claimed. GitHub CI must independently pass before merge.
- No live providers or production database used.
