# Codex device OAuth operator authentication

## Issue and problem

- Issue: #635
- Users want Codex subscription access via device-code sign-in, not separately billed API keys.
- Current direct OpenAI transport calls Chat Completions with API keys. It cannot consume Codex login credentials.

## Scope and expected behavior

- Add an operator-only `codex:auth` command for login, status, and logout, delegating to the official installed Codex CLI.
- Require an absolute administrator-selected executable and a separate private CODEX_HOME; never inspect or export credentials.
- Login uses device authorization and forces ChatGPT authentication with file storage in the isolated directory.
- Out of scope: public authentication endpoints, provider inference, automated authorization, subscription entitlement checks, deployment, API-key fallback.
- No IAM, limits, audit, usage, routing, or external API changes. Authentication management is not inference acceptance.

## Design

- Validate command/configuration before launching a shell-free child in the isolated directory. Permit only selected terminal environment variables, not provider secrets or inherited Codex configuration.
- Login alone inherits the operator terminal so the official CLI can show its verification URL/code. Status/logout output and all wrapper diagnostics are sanitized.
- Reject insecure/symlink homes; serialize operations with an exclusive directory lock; bound child lifetime and clean up the lock. Never log tokens or read auth.json.
- Alternative: duplicate private OAuth endpoints/client IDs. Rejected in favor of official CLI ownership of login and token lifecycle.
- Pending: choose and implement an app-server/Responses inference adapter, token-usage conversion, streaming/tool compatibility, tenant/account mapping, revocation and live acceptance. Do not represent this first slice as a GPT route.
- See [guide](../guides/codex-oauth.md), [contract](../../contracts/codex-oauth.md), PRD, architecture and acceptance addenda for boundaries.

## TDD plan

- Add a public command integration test before production code; expected red: missing entrypoint/module.
- Test device-auth arguments, environment isolation, private directory mode, sanitized status/logout and nonzero errors, missing executable, invalid action/configuration, symlink/insecure homes, locking and bounded termination.
- Implement the smallest operator wrapper, then run focused tests, typecheck/lint, planning checks and full npm run check.

## Delivery

- Research official authentication and app-server documentation and upstream device_code_auth.rs (2026-11-01).
- Issue first, feature branch, plan, red/green tests, implementation, documentation, reviewed PR.
- No real credentials, model calls or host changes during tests. Operators must protect the directory and terminal; rollback removes the command and separately revokes credentials using Codex/account controls.
- Verification evidence and remaining limitations will be recorded in the PR.

## Verification evidence

- RED: missing identity module failed public test import; process-tree regression then reproduced two surviving-descendant failures (8 pass / 2 fail).
- GREEN: 10 focused tests pass, including timeout and abort with descendants ignoring SIGTERM, lock retention during grace period, and SIGKILL escalation.
- Focused Biome check, repository lint (existing warnings/information), planning/link/contract/fixture scan, six pinned compatibility checks and git diff whitespace check pass.
- Full npm run check is NOT green: typecheck was killed on the shared 2 GiB cgroup host. No typecheck-success claim.
- Separate sequential full tests: 8777 tests, 8749 pass, 27 failures, 1 optional PostgreSQL skip. 26 file processes received SIGKILL; one service CLI readiness test timed out. These failures are not waived or presented as a passing suite; CI/adequate-host validation remains required.
- Independent read-only reviews found process-tree cleanup and documentation gaps; fixed with regression coverage. Final auth-only scoped review found no remaining blocker, but does not substitute for repository approval.
- No live authorization, account login, CLI installation, provider call, subscription entitlement test, VM deployment or gateway inference registration performed.

## Pre-cancelled operation regression (2026-11-02 Asia/Seoul)

1. Existing cancellation contract: reject an already-aborted operation before any credential-directory creation or child execution.
2. Add a login regression with a pre-aborted signal and absent home; require sanitized rejection and no home creation (RED before implementation).
3. Add the smallest early cancellation guard, then run focused auth tests, lint and planning checks. No OAuth, inference or installed acceptance is implied; exact-head CI and independent approval remain required.

Observed: RED rejected the command but stat(home) unexpectedly succeeded, proving cancelled login created storage. GREEN: all 11 auth tests pass on Node22.23.4, focused Biome/planning/diff checks pass. Full local typecheck/test suite and live OAuth/inference were not rerun; new exact-head CI/review are pending.

## Cancellation during validation regression (2026-11-02 Asia/Seoul)

1. Cancel immediately after invocation while asynchronous executable validation is pending; the command must not proceed to create credential storage or launch a child.
2. Add the public API regression first and record RED, then observe cancellation immediately before storage creation. Existing cancellation and lock/process cleanup semantics remain unchanged.
3. Run focused tests, lint and planning validation; require fresh exact-head CI and independent approval. No live OAuth, inference or deployment claim.

Observed RED: the asynchronous-validation cancellation regression rejected the operation but still created home (11 pass / 1 fail). A cancellation check immediately before mkdir restores GREEN (12/12 on Node22.23.4); focused Biome, planning scan and diff checks pass. Logs: /tmp/og-0330-codex-{red,green}.log. Prior HEAD 4e1de0f CI run 41334463220 passed typecheck/full check and all 8925 tests; this is not evidence for the new HEAD or live acceptance. Full local resource failures remain recorded above; no new full local suite run.
