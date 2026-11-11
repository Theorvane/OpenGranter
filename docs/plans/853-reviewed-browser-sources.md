# Explicit reviewed public browser sources

## Issue and problem
- Issue: #853; parent #637, #639, #642.
- Canonical FE 2591928 imports pure audit and usage validators outside management. Existing reviewed build fails with three source-boundary errors; no deployable canonical artifact can be produced using that gate.

## Scope and expected behavior
- Add an explicit trusted build caller publicSources list and repeated CLI --public-source arguments. Each exact additional TypeScript file must resolve within repository src. Management entries remain mandatory; every shared transitive dependency must be listed independently.
- Default management-only restrictions, bare/node import rejection, single in-memory browser module and non-overwriting artifact publication remain unchanged. This is not a secret scanner or permission to select server files blindly.
- No FE-owned views, session, CSRF, IdP, runtime listener, DDL, provider, budget or accounting changes.

## Design
- Canonicalize root/src and each grant; reject escapes, non-TypeScript and invalid grants before bundling. Grant no directory or transitive wildcard authority. Entry cannot use the list to escape management. CLI rejects unknown/duplicate output/missing argument forms with existing fixed error.
- Alternative broad src allowance rejected: it silently widens every existing build. Explicit reviewed grants make changed publication intent auditable.
- FE owns canonical source and still must review eight shared validator files before release. Browser login and live API integration remain blocked separately; build success is not acceptance.
- Update PRD, architecture, acceptance and contracts/management-browser-build.md.

## TDD plan
- RED: management fixture imports explicit shared pure source; old builder rejects it. Then allow only exact shared files, test missing transitive grants, outside-root/symlink/non-TS grants, shared entry denial, node/package rejection, CLI option handling, unchanged publication and default tests.
- GREEN: focused browser builder tests, strict typecheck/lint/planning/compatibility; standard npm run check separately and preserve failures. Build actual canonical FE through new API with all eight shared files, without editing its worktree.

## Delivery
- Own scripts/build-management-browser.ts, builder test and documentation only. Separate issue branch based main6757eee. No FE file changes. Review exact HEAD and require all CI+formal approval before merge.
- Rollback: omit publicSources or revert this additive build API. No runtime or migration effect.

## Verification evidence (2026-11-11)
- Meaningful RED: /tmp/og-1030-red.log, explicit shared-source build fails at the old management-only boundary (1 test, 1 expected failure).
- GREEN: /tmp/og-1030-green-final.log and fresh /tmp/og-1330-build-tests.log, 11/11 passed, zero skipped. Strict typecheck, focused Biome and planning/contract scan pass; Biome retains four informational template suggestions, no errors.
- Standard npm run check: /tmp/og-1030-fullcheck.log FINAL exit 0, 9,333 tests / 9,332 pass / 0 fail / 1 skip. That skipped test is not live acceptance.
- Fresh canonical FE2591928 build: 130,653 bytes, SHA-256 9cab1c847be956377490b4f10551f54134bf3c73d0e8901f19bf90b0090c5348; eight explicit shared source grants, no FE edits. The selected FE revision and grants still require independent publication review.
- Local browser http://127.0.0.1:18954/management renders signed-out management navigation and Usage history sign-in-required state. Audit clicks appeared to render Account; sent the observation to the FE owner rather than changing owned navigation. No login/private SQL API/provider/install acceptance is claimed.
- Fresh npx invocations encountered a nonexecutable installed npx launcher; direct node invocation of installed TypeScript and Biome succeeded. This is a tool-launch issue, not a source or filesystem denial.
