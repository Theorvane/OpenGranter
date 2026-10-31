# Optional hardened systemd gateway service

## Issue and problem

Issue #570 follows optional system-service packaging in [#566 plan](566-container-packaging.md) and [service guide](../guides/service.md). Linux operators otherwise assemble signal ownership, identity and filesystem restrictions manually.

## Scope and expected behavior

An opt-in systemd unit, not an installer or default deployment. Dedicated existing non-root account, root-owned release /opt/opengranter, trusted bootstrap under /etc/opengranter, loopback binding, direct Node invocation, no automatic restart/replay. Secret/limit/database ports stay explicit; no new API, permissions, accounting, migration rollback, readiness, SSO or production certification.

## Design

Type=simple describes process creation, not readiness. A 30-second application shutdown deadline and 40-second systemd stop grace. Protect system/home files, drop capabilities, deny privilege elevation, private temporary space. Do not add MemoryDenyWriteExecute because Node uses JIT. Node >=22.14 must exist at /usr/bin/node or the operator must override ExecStart. Required environment file carries configuration/references, never provider keys. Trusted bootstrap remains executable code, not sandbox certified. Network-online does not prove PostgreSQL availability.

See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [contract](../../contracts/gateway-service.md). Unresolved deployment order and AWS/on-prem release validation in [ADR](../adr/0002-portable-deployment.md) stay open.

## TDD plan

First failing packaging tests for direct invocation, identity, mandatory configuration, no restart, hardening/stop deadlines. Then unit and static systemd-analyze verification in Ubuntu CI. Run focused service/process/package tests, types, lint, document checks and standard full gate. Local systemd tooling/PID1 are absent; static CI verification is not running-systemd or production acceptance.

## Delivery

Exact-head full CI and independent GitHub approval required. Document manual installation, ownership, bootstrap import paths, environment-file limits, override timeout consistency and rollback. Stop before switching immutable releases; never replay potentially billed work. Do not touch #561. Host startup, real providers, production secret/quota systems, recovery and load remain operator acceptance work.

## Verification evidence

- Red: three new packaging tests failed with ENOENT for the absent unit before implementation. Green: all18 focused packaging/network/service/process tests passed. New test formatting, planning/link/contract/fixture-secret scan and diff whitespace checks passed.
- Full npm run check is being run with CPU affinity0 and constrained Go compiler memory because of the shared2GiB environment. Final result must be recorded before publishing the PR.
- systemd-analyze and a running systemd host are unavailable locally; Ubuntu CI performs static unit verification only. No actual host installation or production connectivity claim.
