# OpenCode streamed tool lifecycle and controls

## Issue and problem

- Issue: #367; release gate #116 remains open. The named application text probe does not establish actual tool-result
  continuation, policy denial signaling or disconnect accounting.

## Scope and expected behavior

Extend installed OpenCode 1.18.5 conformance over both bases with incremental read-function fragments, an actual temporary fixture-file read and correlated tool-result continuation. Evaluate fresh IAM and limits for every request; verify explicit model and provider Deny before secrets and process-termination cancellation with failed accounting. Restrict reads to the single temporary fixture, deny all other tools and external skills, and retain bounded child lifetime/output and cleanup. No product API, provider routing or schema behavior changes; broader app cancellation/failure semantics, direct streaming and full #116 remain open.

## Design

- Extend the existing isolated process runner and fixed-host gateway fixture.
- Preserve text and public HTTP guards, fixed destinations and immutable capture.
- Deny all tools except reading the single project-relative fixture file. Retain
  external-skill isolation, bounded children and cleanup; record structured application
  events and explicit exit status without printing response bodies.
- Process termination is a disconnect probe, not certification of every interactive
  cancel action. No new domain terms, ADR decisions, production API or pin changes.
- Update PRD, architecture, acceptance, compatibility and a dedicated contract.

## TDD plan

- Add public gateway fixture regressions first: absent streamed fragments, incorrectly
  accepted Deny and absent abort/failed accounting are the expected red.
- Cover both bases, correlated result history, fresh IAM/limits/credentials, explicit
  model/provider Deny, and cancellation with missing-usage possibly-billed failure.
- Add a process-result regression before allowing explicit nonzero exit observation;
  preserve sanitized errors for timeout/overflow/spawn failure and the prior wrapper.
- Run the exact installed application separately; retain default text/config tests.
- Run format and full npm run check before review.

## Delivery

- Issue and plan before code; record red/green evidence in PR. Exact-head review
  by sjungwon03-ai and both CI checks precede sjungwon03 squash merge.
- Function fragments are response content, never operational audit/usage data.
- Missing usage remains unknown; do not claim complete #116 compatibility.

The temporary work directory is initialized as an empty Git project so OpenCode
uses the fixture root for project-relative read permission matching. Only the
fixture.txt literal is allowed; all other read paths and external directories deny.
This initialization modifies only the temporary directory, never the repository.

## Verification evidence

Extend the opt-in installed OpenCode 1.18.5 runner with incremental read-function assembly, actual single-file execution and correlated result continuation, explicit model/provider Deny and process-termination upstream cancellation on both gateway bases. Every successful request rechecks authentication, IAM and limits; fragments/results stay out of operational usage/audit metadata. Nonzero child exits can be observed for structured conformance assertions without weakening the existing fail-on-nonzero wrapper.

Red: eight new gateway regressions found missing fragments, 200 rather than 403 for Deny and missing upstream-abort accounting. Process-result capture and fixture-only permission tests also failed before implementation. Green: 18 focused tests pass. The first installed-tool attempt reproduced a permission-matching mismatch; an empty temporary Git project and an exact project-relative fixture.txt allow rule resolve it while denying every other tool/path. All ten installed-client scenarios pass (text, tool/result, model Deny, provider Deny, disconnect over /v1 and /api/v1). Deny is verified as a status-403 error event and exit code 1. Intentional five-second child termination aborts upstream and records failed, possibly-billed, missing usage. No real upstream/provider secrets, user configuration writes, service API change or schema change. Full #116 remains open, including interactive cancel/retry variants, richer tools/direct streaming and broader client configurations.


Full npm run check passes strict types, lint, 1675 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
