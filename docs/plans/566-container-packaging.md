# Hardened gateway container packaging

## Issue and problem

Issue #566. The #564 executable has no reproducible runtime image. Deployment assembly and signal targeting are manual.

## Scope and expected behavior

Provide optional non-root Node22 packaging with locked production dependencies, runtime source and migrations, a minimal allowlisted context and direct Node signal ownership. Preserve explicit bootstrap/secret/limit/database ports and loopback defaults. No API, authorization, accounting, audit or storage changes. No bundled database, production bootstrap, readiness endpoint, SSO listener, automatic replay/restart or complete deployment claim.

## Design

Use the maintained official Node22 bookworm-slim image without a new transpilation toolchain. Install production dependencies in a separate stage with lifecycle scripts disabled. Keep application files root-owned and execute as node. Exclude everything except the explicitly copied runtime files. Mount environment-specific trusted bootstrap code read-only. The base tag is mutable: operators must resolve and record its digest for releases and rebuild for security updates; this is not a signed/reproducible supply-chain certification.

No product decisions are resolved. System-service packaging can be added independently. See [service guide](../guides/service.md), [container guide](../guides/container.md), [contract](../../contracts/gateway-service.md), [PRD](../PRD.md), [architecture](../architecture.md) and [acceptance](../acceptance.md).

## TDD plan

First add packaging contract tests; absence of Dockerfile/.dockerignore must fail before implementation. Assert non-root/direct entrypoint, locked production install, runtime copies and explicit context allowlist. Then implement image and run focused and full repository checks. CI builds the actual image, rejects missing configuration, verifies production-only dependencies, starts against disposable PostgreSQL with deny-all test ports, exercises unauthenticated HTTP and stops with SIGTERM and exit0 on a read-only filesystem.

## Delivery

Issue and plan precede tests/code. Publish red/green and full-check evidence; require CI and approval. Docker is unavailable locally, so actual image validation is delegated to CI and must not be claimed locally. Rollback to the previous executable deployment; committed migrations are not rolled back. Deadline termination may interrupt accounting. Real providers, production secret-manager, load, backup/recovery and environment-specific deployment acceptance remain outstanding.

## Verification evidence

- Red: all three packaging cases failed with ENOENT for missing Dockerfile/.dockerignore before implementation. Green: all three passed; integrated packaging/service/process suite passed14 cases.
- Type checking and lint passed (existing warning/info diagnostics remain). Planning/link/contract/fixture-secret scan and diff whitespace check passed. A separately staged production-only install completed with15 packages and the real executable imported its runtime and refused missing configuration with fixed output and exit1; this is not a container build.
- npm run check was attempted under the shared2GiB limit. Existing migrated-postgres-server tests received SIGKILL; the already-failed parallel run was stopped to release resources. An unmodified full test suite rerun with test-concurrency=1 finished with 8,148 passing, 11 SIGKILL file failures and one skipped case; it did not pass the full gate locally. No assertions or timeouts are weakened. Actual image validation and full standard gate remain CI requirements.
