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
- Representative bounded process-start experiment: run the two delayed-publication cases concurrently with eight Node startups, each executing a busy loop until a 500 ms wall-clock deadline, inside the same two-CPU quota. With the original reader: 0 pass / 2 fail, at the PID assertion after 177.4 ms / 14.0 ms. With the corrected reader: 2 pass / 0 fail / 0 skip. All eight workload processes exited zero in both experiments. The controlled publication gap remained 50 ms; the 300 ms command timeout was unchanged. This is a disclosed fault-injection experiment under Linux load, not repeated CI reruns or proof of the historical cause.
- Clean full `npm run check` with disposable PostgreSQL 17: exit 0; 10,644 pass / 0 fail / 0 cancel / 0 skip, test duration 405,368 ms. Typecheck, lint, planning documents, links, contracts, fixture-secret scan and all six pinned OpenRouter schema checks passed. The full test runner exercised the real Linux process boundaries with two available CPUs. Source verification logs remain at `/tmp/the24-full-check-clean.log`; failed setup and RED logs are retained separately.
- Independent reviewer validated frozen implementation commit `8b9185ef2eebfce586ae1db35c2b83fad9cacb4d` without editing implementation files: exact suite 17/17, plus a separate 150 ms publication-gap/load probe 2/2, on Linux arm64 Node 22.23.4 with half a CPU, a read-only filesystem and no network. The unrelated process sentinel survived, and no live fixture descendants remained. The reviewer's first noexec-tmpfs setup failure is separately retained; allowing executable temporary fixtures corrected that environment without changing assertions. The report is `/tmp/the24-independent-review/report.md` (Orca item202). No actionable implementation defect was found; this was independent AI validation, not human approval.
- Hosted Ubuntu CI and incremental COMMENT-only review of the eventual PR head (including this verification-only documentation update) remain pending. No formal approval, merge, activation or deployment is authorized.

### Process-start experiment harness

Use the checked-out test file for GREEN. For RED, use an ephemeral copy with the original reader (unconditional `break` immediately after `readFile`, sleep only in `catch`); do not change production files or the delayed fixture. Run this JavaScript from the repository root inside a two-CPU Linux container using Node 22:

```javascript
import { spawn } from 'node:child_process';
const loads = Array.from({ length: 8 }, () => spawn(process.execPath, ['--eval',
  'const end=performance.now()+500; while(performance.now()<end) { Math.sqrt(Math.random()); }'],
  { stdio: 'ignore' }));
const tested = spawn(process.execPath, ['--experimental-strip-types', '--test',
  '--test-name-pattern=delayed PID publication', 'test/codex-auth.test.ts'],
  { stdio: 'inherit' });
const closed = child => new Promise(resolve => child.on('close', code => resolve(code)));
const codes = await Promise.all([closed(tested), ...loads.map(closed)]);
console.log({ testExit: codes[0], loadExit: codes.slice(1) });
process.exitCode = codes[0] ?? 1;
```
