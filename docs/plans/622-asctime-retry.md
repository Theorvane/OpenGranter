# Asctime Retry-After normalization

## Issue and problem

Issue #622, refs #116. The #620 error contract explicitly leaves obsolete HTTP-date forms unsupported. RFC9110 section5.6.7 defines asctime-date; section10.2.3 allows HTTP-date for Retry-After. Existing numeric and IMF-fixdate parsing drops this otherwise valid upstream hint. Source: https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7 . Base: approved #621 merged as9b13cdb9572dda085b994be841607d884c8209d7. Do not touch #561.

## Scope and expected behavior

Accept exact24-character asctime-date with ASCII short weekday/month, space-padded single-digit or two-digit day, real UTC calendar/weekday and year1601..9999. Convert to canonical IMF-fixdate before the existing strict round-trip and capture-time normalization. Preserve numeric/IMF-fixdate behavior, invalid-clock rejection and no upstream Date-header trust. Public headers contain only nonnegative safe integer seconds, with ceil rounding and past zero. IAM, limits, required usage/audit, failure privacy, eligible429/503 paths, pre-stream handling and post-frame isolation remain unchanged.

Out of scope: RFC850 two-digit years, retries/sleeps, new statuses, arbitrary Date.parse syntax, skew correction, storage/dependencies/pins, live-provider/deployment certification or complete HTTP-date/#116. No new domain decision or dependency on unresolved #7.

## Design

Add one fixed-shape asctime normalization before existing IMF validation. Accept both grammar-permitted day forms, including zero-padded days; reject noncanonical whitespace. Reuse existing safe clock/calendar and integer validation. This avoids a second permissive parser or timezone-dependent interpretation. Update PRD, architecture, acceptance, compatibility and error contract with the bounded addition; no ADR needed for this reversible parser extension.

## TDD plan

Add deterministic future/fractional/exact/past and earliest/latest/leap-year cases, invalid clock/shape/calendar/weekday/date range cases. Run the new suite before implementation and record expected missing-header failures across both public bases/all four adapters/nonstream/text/function and429/503. Preserve all malformed checks: replace the newly accepted asctime rejection fixture with a weekday mismatch. Run focused date/hint/status/SDK and security/persistence boundaries, then standard npm run check; report failures without replacement-pass claims.

## Delivery

Issue and this plan precede source changes. Add tests, record red, implement minimum parser normalization, run green and gates, open PR, request exact-head read-only review. Normal merge only after formal exact-head GitHub approval and all CI success. Rollback removes only asctime acceptance. Local Docker/bridge/systemd/live providers remain uncertified.

## Verification evidence

Before production changes, the new deterministic unit/public suite ran79 cases:21 passed,58 failed for missing normalization/header behavior. Minimal13-line shared parser extension (including comment change), plus replacing one now-supported rejection fixture with a weekday mismatch, produced317 passes across date and existing hint suites. Final focused date/hint/status/persistence-boundary/actual-SDK selection:425 passed,0 failed/skipped on native Node22.23.4 (about2.1 seconds). SDK retries stay disabled. Numeric and IMF-fixdate coverage remain.

Standard taskset-c0,1 npm run check FAILED with exit137 during tsc --noEmit (Killed); chained lint/tests/docs/pins did not run in that invocation. Do not count this as local typecheck or full-gate success. Separate lint passed with42 existing warnings/110 infos; planning/link/contracts/fixture-secret scan and all six offline source-pin checks passed; git diff --check passed. No check weakening, dependencies or pin updates. Logs: /tmp/opengranter-622-{red,green,final-focused,full,lint,docs,pins}.log. Exact-head formal approval and full CI are still required.
