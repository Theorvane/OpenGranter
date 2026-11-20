# Readable UTC history ranges (#642 / #637)

## Issue and problem
The authorized Usage/Audit filters currently require operators to calculate Unix milliseconds. Entering a UTC timestamp is rejected locally. The original management history requirement needs usable bounded time-range investigation.

## Scope and design
Accept strict explicit UTC ISO strings or existing canonical nonnegative integer milliseconds in the two range fields. Keep inclusive from/exclusive to semantics and existing client validation, authorization, audits, CSV and pagination. Never infer local timezone or normalize invalid dates. Preserve exact draft text and compare parsed time values for applied status. Reuse the existing token UTC conversion by extracting a domain-neutral helper without changing token behavior. Labels disclose the formats. No API/session/BFF/runtime/DDL/activation/retention or deployment changes.

## TDD plan
Reproduce UTC input rejection through the public mount on both tabs before production changes. Verify exact numerical HTTP query values, model/principal/request scope, unchanged numeric compatibility, equal-time draft status, invalid dates/local offsets/reversed ranges issuing zero requests, and denial/disposal. Run bounded DOM and real signed-JWT/embedded-SQL HTTP suites, token parser regressions, strict TypeScript, lint, document checks, browser bundle/native browser and full npm check where resources permit.

## Delivery
Extend existing draft PR #980 only, parent #979 exact4569f365bc481d027c1fc5614ac815b91551d459 already incorporated. Exact-head CI, independent formal approval and parent merges remain required. Roll back the isolated UTC range change. Installed SSO/native PostgreSQL/provider E2E and persistent access URL remain separate acceptance. Update PRD, architecture, acceptance and contract with evidence; no full-check or deployment claim without verification.

## Verification (2026-11-20 09:00 KST)
Meaningful original-source RED: both public-mount UTC range tests failed at the missing bounded request (0 pass / 2 fail), before parser extraction/view integration. Final serial eight-suite regression: 69 pass / 0 fail / 0 skip, including real loopback HTTP with signed synthetic JWT and migrated embedded PostgreSQL. The HTTP cases assert exact UTC-derived from_ms=100/to_ms=104 for pagination and CSV, authorized row isolation, mandatory read audits and fresh Deny. Token expiry parser/panel regressions remain green after pure helper extraction.
Strict full TypeScript, full lint (42 pre-existing warnings/181 infos), document/link/fixture checks, six pinned offline compatibility schemas and explicit public history browser bundle pass. Native Chromium production-bundle tests pass for both tabs: Enter single request, exact UTC milliseconds and scope, equivalent drafts, refresh, invalid calendar stays local, fresh Deny and disposal. Screenshots /tmp/og-200900-usage-utc.png and /tmp/og-200900-audit-utc.png. These are synthetic loopback/browser tests, not installed SSO/native PostgreSQL/deployed or paid-provider E2E.
Literal npm run check launched against the final source/test snapshot; result pending at documentation time, no full-check success claimed. Logs /tmp/og-200900-{utc-red,focused-final,types-final,lint-final,docs-final,compat,native-final,fullcheck}.log. Initial command-only guard refusals did not execute; corrected file staging and no-PID-echo launch. An initial build invocation used unsupported flags; corrected to positional entry and --output, which passed. No other working tree or existing browser/display process modified.
