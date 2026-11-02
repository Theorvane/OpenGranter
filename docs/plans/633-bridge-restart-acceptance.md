# Bridge restart acceptance (#633)

## Issue and problem

Issue: #633. Existing #566/#568 container smoke covers startup and SIGTERM but not a second startup with persisted application data. The agreed limited deployment acceptance needs restart evidence, not additional provider features.

## Scope and expected behavior

Add a disposable CI gateway restart with the same PostgreSQL database. Preserve an inert disabled catalog row and the exact migration history. Repeat the unauthenticated HTTP 401 probe and graceful stop. No API, IAM, limits, secret, audit or usage semantics change; no provider call or real credentials. This is not database restart/volume recovery, authorized health/readiness, production deployment or live-client certification. #561, systemd and unresolved #7 are excluded.

## Design

Extend the existing host/bridge CI smoke using its disposable PostgreSQL service. Insert one disabled model with no route after migration; snapshot migration history, stop/start the gateway, verify both snapshots and stop again. Never seed a permissive route or token. Add an operator checklist with separate unverified live gates. Reuse current container and service contracts rather than invent a health endpoint. See [container guide](../guides/container.md), [acceptance](../acceptance.md) and [service contract](../../contracts/gateway-service.md).

## TDD plan

First add packaging regression assertions for restart, persisted catalog/history checks and repeated HTTP probe. Expect failure before workflow changes. Then implement the workflow and run focused tests, typecheck, lint, documentation/source-pin checks and the standard full gate. Static packaging tests cannot prove Docker behavior: require exact-head Container CI; local Docker is unavailable.

## Delivery

Issue and plan precede tests/workflow. Require exact-head full CI and independent formal approval before merge. Disposable CI data only; no production rollback or paid requests. Actual operator acceptance requires an approved Docker host, protected credentials, a client/provider/model choice and cost authorization. Keep pending gates explicit in the handoff; do not mark the overall goal complete.

## Verification checkpoint

Red: new restart regression failed on missing INSERT INTO catalog_models (1 PASS, 1 expected FAIL). Green: all five network/packaging cases passed; workflow shell syntax and documentation/link/contract/fixture-secret checks passed. The standard full check is running; no full pass or Docker execution is claimed at this checkpoint. Initial invocation rejected an unsupported NODE_OPTIONS test-concurrency flag before running checks; corrected invocation removes that flag and uses the unchanged standard npm run check.
