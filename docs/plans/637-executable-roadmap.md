# Executable product roadmap

## Issue and problem

- Issue: [#637](https://github.com/Theorvane/OpenGranter/issues/637).
- The original PRD includes a management UI, but the baseline ships gateway primitives without that UI. The prior phase table lacks actionable UI/API delivery slices and evidence-separated completion gates.
- User requested decomposition and continued execution on 2026-11-01 (Asia/Seoul).

## Scope and expected behavior

- Replace the roadmap with linked, dependency-ordered work slices, accountable roles, explicit decisions and release gates. Preserve original scope and track later Codex work separately.
- No production behavior, API authority, credential handling, usage calculation or deployment changes in this PR. No release-completion or schedule promise.
- Keep existing compatibility and operational acceptance obligations rather than restart or discard their evidence.

## Design

- R0 traceability precedes browser/session contracts. Deliver UI foundation, identity/policy/credential administration, catalog/routing/limits, usage/audit/export, compatibility reconciliation, then installed release acceptance.
- A read-only MVP is an increment, not a reduction of original scope. Reuse existing backend primitives after inventory.
- Alternatives: continue gateway-only iterations or implement an isolated UI mock. Rejected because neither establishes authorized end-to-end administration.
- Open decisions and dependencies are listed in [the roadmap](../roadmap.md). No unanswered security policy is converted into a requirement.
- Product and acceptance authority remain [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md) and [compatibility](../openrouter-compatibility.md).

## TDD plan

- Documentation only; no production-code RED/GREEN is claimed or required. Future implementation slices must provide their own numbered plans and meaningful failing tests before code.
- Validate planning documents, relative links, contracts and fixture secret scan with `python3 scripts/check.py`; run `git diff --check`.
- Review coverage against original PRD and require independent review of the roadmap before merge.

## Delivery

- Create umbrella and child work issues; record R0 as active and other slices as queued or existing work in progress.
- Publish the roadmap and retain execution state in the coordinator work item. Continue safe R0 source/API evidence collection while documentation review runs.
- Risk: mistaking proposed role ownership, CI, or an issue list for delivered functionality. Mitigation: explicit status/evidence rules and separate installed/live gates.
- Rollback: revert documentation; no runtime or data rollback required.
- PR evidence: document-check output, whitespace check, exact commit, child links and independent review. No live provider or browser certification is implied.
