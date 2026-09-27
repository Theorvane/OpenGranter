# TDD and Planning Workflow

## Issue and problem

- Issue: `#1`
- Problem: The initial harness asks for contract updates before behavior changes, but it does not require a confirmed failing test or an issue-specific plan for each implementation.
- Affected contributors: Developers and coding agents working on OpenGranter.

## Scope and expected behavior

- Require an English plan before implementation, linked to the issue and pull request.
- Require a red–green–refactor cycle for production-code changes and a failing regression test before bug fixes.
- Record the focused red and green commands and outcomes in the pull request.
- Apply `sjungwon03`'s authorized DCO trailer to commits prepared for their requested work while keeping human code review separate.
- Keep documentation-only changes subject to document checks without inventing product tests.
- No runtime API, permission, secret, usage, or audit behavior changes in this documentation update.

## Design

- Put the authoritative workflow in `CONTRIBUTING.md` and `AGENTS.md`; retain `CLAUDE.md` as the symlink to `AGENTS.md`.
- Add a reusable plan template and PR prompts so planning and test evidence are reviewable.
- Keep product-specific acceptance and contract documents updated whenever their behavior changes. Use an ADR only for a consequential decision with a genuine trade-off.
- No product architecture decision is made by this workflow change.

## TDD plan

- This change edits documentation and templates only; there is no production behavior to test first.
- Run `npm run check` to verify document links, language, contracts, types, lint, and existing tests.

## Delivery

- Update the contribution, coding, harness, agent, and pull request instructions.
- Add this plan and the implementation-plan template.
- Confirm `CLAUDE.md` remains a symlink and all checks pass.
