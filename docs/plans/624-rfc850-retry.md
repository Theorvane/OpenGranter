# RFC850 Retry-After normalization

## Problem and scope

Issue #624, refs #116. Approved #622 explicitly leaves RFC850 HTTP-date unsupported. RFC9110 sections5.6.7 and10.2.3 define this grammar and two-digit-year rule. Source: https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7 . Base: approved #623 merged as53344cfe908909181ed377c19341c4a872665a98. Do not touch #561.

## Design and observable behavior

Accept only full English weekday, comma-space, two-digit day, hyphen, short month, hyphen, two-digit year, space, HH:mm:ss and literal GMT, total30..33 characters. Resolve to the latest matching year whose timestamp is not more than50 UTC calendar years after the trusted capture clock; require year1601..9999 and existing exact calendar/weekday round-trip. RFC850 requires a finite capture clock with UTC year1601..9999. Exactly50 years remains future; one second beyond maps back100 years. No upstream Date-header clock trust. Reuse ceiling/nonnegative safe-integer seconds and numeric/IMF/asctime behavior.

## Boundaries and decisions

No new product/domain decision, status, retry/sleep/skew policy, storage, dependency, pin or operational claim. Preserve all four adapters, both bases, nonstream/pre-stream paths, IAM/limits, required usage/outcome audit and privacy/post-frame isolation. Noncanonical syntax, leap seconds and out-of-range years remain rejected. Liberal parsing and #116/#7 completion remain out of scope. No ADR/glossary change for this reversible protocol-parser extension.

## TDD and implementation

Add future/fractional/past/exact50-year and one-second-over cases, century rollover, leap dates, weekday/calendar/clock/grammar/size rejection. Reuse public429/503 nonstream/text/function cases and pinned OpenAI/OpenRouter/AI SDK sockets with retries disabled. Run red before source; normalize exact grammar to IMF and run green. Replace only newly valid RFC850 rejection fixtures with weekday-invalid examples if needed. Run focused privacy/persistence/status regressions and standard npm run check; record failures honestly and separate docs/lint/pins if the chained gate stops.

## Delivery and rollback

Plan precedes source. PR includes red/green evidence; exact-head review, all CI success and formal GitHub approval required before normal match-head merge. Rollback removes only RFC850 acceptance. Local Docker/bridge/systemd/live providers remain uncertified.

## Verification evidence

New unit/public/actual-SDK tests ran before source changes:131 cases,22 passed,109 expected missing-normalization/header failures. After the minimal shared-parser change and replacing the now-valid RFC850 rejection fixture with a weekday mismatch, focused date/retry/status/persistence/SDK selection passed536 tests,0 failures/skips on native Node22.23.4. SDK automatic retries remain disabled.

Standard npm run check could not start: the pre-existing native Node22 npm installation failed with MODULE_NOT_FOUND walk-up-path (exit7). No shared tool installation was modified; fallback system npm is absent. A separate native Node22 taskset-c0,1 tsc --noEmit failed exit137 (Killed). Neither is a passing full gate/typecheck. CI and formal approval still required. Local Docker/bridge/systemd/live providers remain uncertified.

Final focused selection also included upstream-status-boundaries:556 passed,0 failed/skipped (2.8 seconds). Separate lint passed with42 existing warnings/110 infos; planning/link/contracts/fixture-secret scan and all six offline pin checks passed; git diff --check passed. Logs: /tmp/opengranter-624-{red,green,focused,final-focused,typecheck,lint,docs,pins}.log. The earlier536-pass selection did not include upstream-status-boundaries.
