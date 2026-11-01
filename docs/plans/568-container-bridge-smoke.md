# Container bridge smoke (#568)

## Scope

Close the networking validation gap left by #566: retain host CI and add bridge CI using disposable PostgreSQL, explicit 0.0.0.0 listener, loopback-only published HTTP, read-only root/bootstrap and graceful SIGTERM. No runtime defaults, credentials, authorization or production-readiness changes. See [container guide](../guides/container.md), [previous plan](566-container-packaging.md) and [acceptance](../acceptance.md). #561 remains separately owned.

## TDD and delivery

Add failing network packaging assertions before implementation. Then run focused tests, typecheck, lint and source/document checks. Actual Docker and full repository gate require CI; Docker is unavailable locally. Require exact-head GitHub approval and successful CI before merge. Preserve previous local SIGKILL evidence.

## Verification

Issue and plan preceded implementation. Red: the added network regression failed on missing host/bridge matrix. Green: all four network/packaging tests passed after the workflow change. Typecheck and lint passed (existing non-blocking diagnostics remain). Actual Docker validation and the full standard gate remain CI requirements; no local image or operational success is claimed.
