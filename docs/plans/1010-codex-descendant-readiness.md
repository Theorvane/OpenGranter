# Codex descendant fixture readiness

## Issue and problem

- Issue: [#1010](https://github.com/Theorvane/OpenGranter/issues/1010), Linear THE-24.
- The Linux descendant timeout test failed at `assert.ok(pid > 0)` in CI attempt 1 of run 46121192919. Its recorded duration was 42 ms, before the 300 ms timeout. The shell opens/truncates the PID file before writing; the reader currently accepts an empty read as a completed publication (`Number('') === 0`). This is a candidate fixture race, not evidence of a production termination regression.

## Scope and expected behavior

- Fix only descendant fixture readiness and add deterministic coverage of delayed PID publication under Linux process load.
- Preserve real descendants, the 300 ms command timeout, the 1000 ms SIGTERM grace/SIGKILL escalation, lock assertions, and termination assertions. Do not skip or weaken tests.
- No public behavior, permission, secrets, audit, usage, provider, OAuth, or routing changes. Existing PRD, architecture, acceptance and `contracts/codex-oauth.md` behavior remains authoritative and unchanged.

## Design

- Poll until a positive safe integer PID is actually published; missing and empty files are not readiness. Keep the existing bounded polling window and timeout/abort paths.
- Exercise both immediate publication and a shell-held empty file before publication, preserving actual OS process-group signals. The controlled delay models scheduling between open and write, separately from the command termination deadline.
- Do not extend production deadlines or change authentication code. No new domain terms, irreversible decisions, or ADR are needed.
- Original CI root cause remains unconfirmed without instrumentation; report the reproduced mechanism and its limits explicitly. Linux container evidence is distinct from hosted Ubuntu CI evidence.

## TDD plan

- First add a delayed-publication variant without changing the reader; run on Linux and record the expected PID assertion failure.
- Correct readiness validation; run the same regression and both original termination paths, then run a bounded process-start load experiment and the required full `npm run check`.
- Preserve unrelated-lock denial, owned-lock lifetime/release, private diagnostics, and public CLI signal tests. No production-code change is planned.

## Delivery

- Use branch `fix/1010-codex-descendant-readiness`, record all failures and environment details, and link this plan in the PR.
- Obtain independent validation through coordinator using `sjungwon03-ai`; no formal approval or merge.
- Risks: Linux architecture/scheduler differences and the original CI race cannot be retrospectively proven. If representative reproduction or full validation is unavailable, report the exact blocker rather than claim completion.

## Verification record

- Environment: real Linux container on a macOS host; OrbStack kernel `7.2.12-orbstack-00394-gbecdd6130068`, Debian 12, arm64, Node `22.23.4`, two available CPUs (`cpu.max = 200000 100000`). This is not hosted Ubuntu x64 evidence.
- RED: `node --experimental-strip-types --test --test-name-pattern='termination stops descendant' test/codex-auth.test.ts` with delayed-publication cases and the original reader: 2 pass / 2 fail / 0 skip. The delayed timeout and abort cases failed the unchanged positive-PID assertion in 28.7 ms and 20.5 ms, before the 300 ms timeout.
- An intermediate reader correction without sleeping between empty reads also failed both delayed cases (54.1 ms and 36.7 ms); the final reader retains a 10 ms delay after every unsuccessful read.
- GREEN: `node --experimental-strip-types --test test/codex-auth.test.ts`: 17 pass / 0 fail / 0 skip, including both publication modes and both termination reasons. No production files changed.
- Full-check setup failure: an initial macOS tar copy included AppleDouble `._*.sql` metadata files, which correctly caused migration-manifest rejection. That contaminated run was stopped, its log retained, and those files removed only from the disposable container before a clean full check. An initial production-mode dependency install also omitted development tools; the environment was corrected using `npm ci --include=dev` and Python 3.11.2.
- Clean full `npm run check`, hosted CI and independent reviewer validation are pending. Do not interpret the focused GREEN result as those validations.
