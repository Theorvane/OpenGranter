# Visual onboarding and documentation

## Issue and problem

- Issue: [#562](https://github.com/Theorvane/OpenGranter/issues/562).
- Readers currently encounter planning internals before a concise product explanation or evaluation path. TypeMCP in the same organization demonstrates useful hero, capability, quick-start, and task-based navigation patterns.

## Scope and expected behavior

- Refresh the English README, add a documentation index and evaluation guide, and include original architecture artwork and a real local verification transcript visualization.
- Preserve existing technical references and distinguish tested modules from release readiness.
- No runtime, API, permission, secret, usage, audit, dependency, or storage changes. No fabricated dashboard or deploy command. No third-party artwork is copied.

## Design

- README: value proposition, status boundary, architecture, capability table, quick start, output visualization, and documentation links.
- Documentation index: goal-based paths to existing requirements, contracts, and conformance evidence.
- Evaluation guide: prerequisites, offline/local checks, optional disposable PostgreSQL, and production responsibilities.
- Assets: original SVG overview plus an SVG rendering of actual focused contract-test output, with provenance and reproduction notes.
- Existing PRD, architecture, acceptance, and contracts remain authoritative and unchanged because behavior does not change.
- Open decisions: service packaging, management UI, and deployment remain release work, not assumptions for this documentation change.

## TDD plan

- Documentation-only: no new production-code test or invented red/green cycle.
- Run the planning-document checker and full repository checks when prerequisites permit. Inspect links and asset rendering.
- Capture a real passing focused contract run, retain the transcript for reproducibility, and state the limits of that evidence.

## Delivery

1. Record issue and plan on an issue-numbered branch.
2. Inspect implementation and existing conformance boundaries.
3. Write the README and navigation/evaluation documents; generate original assets.
4. Verify document links and checks, inspect the visual output, and open a PR with evidence.
- Risks: attractive presentation could imply a released hosted service; mitigate with prominent development status and explicit visualization captions.
- Rollback: revert documentation and assets only.
- Verification evidence: record actual commands, outcomes, any skipped PostgreSQL tests, and visualization provenance in the PR.

## Verification outcome

- Focused policy/routing contracts: 15 passed, 0 failed, 0 skipped on Node.js 22.23.4.
- Planning checker, new-document local links, SVG XML, and all six offline OpenRouter schema pins passed.
- The full repository gate was attempted in a temporary source mirror with the same source revision and changed documents; the typecheck process was killed by the environment before later stages ran. It is not reported as passing. No external PostgreSQL database or live provider was exercised.
- Chromium/CDP and headless capture were unresponsive. Instead of inventing a screenshot, retain the real transcript and explicitly label its SVG rendering as a visualization, not a browser/product screenshot. Visual browser inspection remains pending.
- PR remains draft pending CI, review, and human DCO sign-off or explicit authorization to apply it.
