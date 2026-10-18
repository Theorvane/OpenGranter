# Agent continuation handoff

## Issue and problem

- Issue: [#520](https://github.com/Theorvane/OpenGranter/issues/520).
- Another agent needs a repository-owned continuation guide without access to the original chat. Existing plans and compatibility notes are extensive, and historical checkpoints can be mistaken for current status.

## Scope and expected behavior

- Add an English handoff with a verified timestamp, merged checkpoint, local worktrees, open release issues, reading order, subsystem entry points, validation evidence and immediate continuation steps.
- Link the guide from README. Distinguish shipped subsets from unresolved decisions and explain how to refresh mutable GitHub state.
- Documentation only: no API, IAM, secret, usage, audit, source pin or production behavior changes. Do not define a new product requirement or silently close release gates.

## Design

- Keep one discoverable guide at docs/HANDOFF.md, with relative links to authoritative rules, plans and contracts rather than copying their full content.
- Record that PR #519 was approved on its exact head, passed all checks and merged as c7cbbbe before taking the handoff snapshot. Preserve broad #116 and unresolved #7.
- Treat workspace paths and /tmp evidence as session-local conveniences; tracked tests, plans and GitHub CI remain the reproducible sources. Do not archive unrelated worktrees.
- Product scope remains in PRD/architecture/acceptance. No glossary, ADR or product-contract changes are needed for this documentation request.

## TDD plan

- No production behavior changes, so a new failing production test is not applicable.
- Verify each local document/source link, recorded GitHub status, commit/identity checkpoint and documented commands against the repository.
- Run python3 scripts/check.py and git diff --check. Do not rerun the full production suite solely for prose.

## Delivery

- Open an issue-numbered documentation branch from current main, add the plan before editing the handoff, then open a ready PR with authorized author/committer, DCO and Assisted-by trailers.
- Keep mutable statuses explicitly dated and require the next agent to refresh them. Reverting the guide/README link has no runtime effect.
- Record documentation validation in the PR and below after completion.

## Verification evidence

- Confirmed PR #519's approval commit matched d5ce2cef7cada53184362f39b8279a06767e25e5 and all three checks succeeded before merging. Verified main at c7cbbbe and issue #518 closed.
- Refreshed open issues, checked worktree locations and confirmed CLAUDE.md still points to AGENTS.md. The handoff distinguishes session-local evidence from committed tests and plans.
- python3 scripts/check.py passed planning documents, links, contracts and the fixture-secret scan. git diff --check passed. This documentation-only change does not require a new production test or another full production-suite run.
