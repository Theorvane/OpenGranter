# Canonical HTTP-date retry hints

## Issue and problem

Issue #620, refs #116. The existing error inventory explicitly leaves HTTP-date retry hints open. The shared parser currently rejects dates on every registered nonstream and pre-stream adapter. RFC 9110 section10.2.3 permits Retry-After as HTTP-date or delay-seconds; section5.6.7 defines the preferred IMF-fixdate and two obsolete forms. Sources: https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3 and https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7 . Base is approved/merged #619 fe9812813870156b2c79eda4ab6e0988454245e3; #618 closed. #561 is untouched.

## Scope and expected behavior

Accept only exact29-character canonical IMF-fixdate with a real matching UTC weekday/calendar and year1601..9999. Convert at upstream rejection capture using the local UTC wall clock: max(0, ceil((date-now)/1000)). Past dates become zero. Preserve bounded safe-integer delta-seconds byte-for-byte behavior and revalidation after required persistence. Return only canonical seconds, never the raw date. Unknown/invalid clock rejects date hints. Advisory capture-time delay is not recalculated after persistence.

No retry/sleep/fallback change, upstream Date-header clock correction, obsolete date forms, new status projection, generated output behavior, dependencies/pins/storage or full RFC/error/#116 certification. The existing IAM, limits, secret privacy, missing/possibly-billed accounting, required usage/audit and post-frame isolation apply unchanged. This bounded addition needs no domain or irreversible architectural decision; unresolved #7 stays unresolved.

## Design

Extend the existing shared parser with an optional millisecond clock argument defaulting to Date.now. Match a fixed ASCII shape before Date.parse, require finite timestamp and exact toUTCString round-trip, then normalize with safe-integer validation. All existing adapters already call this parser only for supported rejected responses. Do not trust unbounded generic Date.parse or forward untrusted text. Numeric hints do not depend on the clock. Update error contract, compatibility, acceptance, PRD and architecture with the limited normalization rule.

## TDD plan

Write deterministic unit cases for future/fractional/exact/past times, leap/calendar/weekday invalidity, malformed/obsolete/repeated hints and invalid clocks. Add real public handler cases on both bases/all four adapters/nonstream and text/function pre-stream paths with frozen Date.now, fixed usage/audit/privacy expectations and no extra provider attempts. Existing date-rejection fixtures become weekday-invalid fixtures; do not remove malformed coverage. Record red before the smallest parser correction. Run focused hint/status/SDK/routing tests, standard CPU-affinity npm run check, planning and pins; disclose all failures rather than weakening checks.

## Delivery

Issue and plan precede tests/source. Open PR with exact HEAD evidence, request read-only code review, and require formal exact-head approval plus all CI before normal squash merge. Rollback removes date acceptance only, with no persisted migration. Local Docker/bridge/systemd/live-provider acceptance remains unverified.

## Verification evidence

Initial meaningful red:74 cases,19 passed and55 failed before production changes. Minimal shared-parser implementation and replacement of two newly-supported canonical-date rejection fixtures with weekday-mismatched dates produced314 passes across the new date cases and existing nonstream/pre-stream hint suites, zero failures. No assertion weakening or retries introduced.

Final focused date/hint/status/SDK selection:566 passed,0 failed/skipped (~2.6 seconds) on native Node22.23.4. Lint passed with42 existing warnings/110 infos; planning/link/contracts/fixture-secret scan and all six offline source-pin integrity checks passed. Standard taskset-c0,1 npm run check FAILED at typecheck: tsc was Killed; the chained lint/test/docs/pins stages did not run in that invocation. A prior standalone typecheck did not return verified success. Separate focused/lint/docs/pin results are not a replacement full pass. No timeout/assertion/concurrency gate weakening or full-gate retry. Full CI remains required. Logs /tmp/opengranter-620-{red,green,focused,full,lint,docs,pins}.log. Local Docker/bridge/systemd/live-provider behavior remains unverified.
