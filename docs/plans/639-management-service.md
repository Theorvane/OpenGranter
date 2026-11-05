# Explicit management service process

## Problem and scope
The owned audited catalog/token listener (#683) has no executable service entrypoint. Refs #639, #641 and parent #637. Make it runnable without exposing an inference listener or inventing browser session/IdP contracts.

## Design and numbered plan
1. RED: require a dedicated management bootstrap factory and management-only environment, loopback/default port 8081, fixed private failures and managed signal shutdown. Existing gateway bootstrap must not be accepted as management bootstrap.
2. Extract existing tested process lifecycle into a typed reusable runner, preserving inference behavior. Add a management wrapper and executable npm command. Trusted factory supplies openConnection, registered issuer/audience/JWKS and optional public browser bundle. Runtime retains authentication, fresh policy and durable audit.
3. GREEN: test independent config, bootstrap rejection, process-owned host/clock/request ID, single shutdown, signal races, timeout and private errors. Run both service suites plus catalog runtime tests, typecheck/lint/planning checks and full CI.
4. Request independent exact-head review. Merge only after formal approval and all required CI succeed.

## Acceptance and limits
Start: OPENGRANTER_MANAGEMENT_BOOTSTRAP_MODULE=/absolute/trusted/module.ts npm run management:start. Optional OPENGRANTER_MANAGEMENT_HOST/PORT/SHUTDOWN_MS configure only this process. Module exports createManagementPorts. Missing/invalid config exits before import. No provider resolver, inference startup, cookie session, user binding provisioning, paid call or deployment activation. Local process tests do not prove installed PostgreSQL, company SSO, browser login or live provider E2E. Rollback by stopping this explicit process and reverting code; no schema changes.
