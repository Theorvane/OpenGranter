# Management boundary native DOM smoke (R1.3)

## Scope

Refs #639 and #637. Exercise the existing presentation mount adapter in an actual browser, without inventing session contracts. Add a dependency-free fixture and a Node generator that embeds the current TypeScript source after type stripping. Output is a local test document, not a management application or production endpoint.

## Acceptance and TDD

Use native elements to verify all five states, status/alert and live-region attributes, repeated transitions, stale protected nodes detached, hostile inputs not coerced, no active controls, and preservation of an adjacent caller-owned root. The fixture reports explicit PASS/FAIL without reflecting exceptions or inputs. First generate with a temporary no-op mount to observe a meaningful stale-node failure; restore the implementation and verify GREEN in the same browser. Run existing focused unit tests and planning checks. No new dependencies or security-contract decisions.

## Execution

Generate with Node >=22.14 using --experimental-strip-types and scripts/management-boundary-browser-fixture.ts, redirect stdout to /tmp/management-boundary-smoke.html. Serve that generated file with a loopback-only static server, then open it in a browser. It must report PASS for every case; load/module failures are failures, not acceptance. Keep exact-head CI and independent approval as merge gates.

This is component-only browser evidence, not installed login/logout, session expiry detection, API authorization, Docker, ingress or live-provider acceptance. Remove the two unused fixture files to roll back; no runtime wiring changes.

## Observed evidence (2026-11-02 Asia/Seoul)

Native browser RED: temporary no-op mount left the private-controls button connected and the fixture reported FAIL. Restoring the unchanged production adapter produced PASS 7/7 component cases in the page accessibility snapshot. An initial fixture accidentally contained a literal closing script tag inside a test string, so it did not execute; replaced that test payload before the meaningful RED/GREEN runs. This harness failure was not treated as a production defect.

Existing renderer/mount unit tests: 14/14 PASS with Node 22.23.4. Generator strict focused typecheck PASS; initial TypeScript 7 invocation required --ignoreConfig. Biome formatting/check passes with one non-blocking string-concatenation style advisory. Planning checker and diff whitespace checks PASS. No full local npm check is claimed; CI remains required. Production adapter source is unchanged after the RED experiment.
