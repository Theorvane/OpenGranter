# Preserve exact Unicode history filters (#642)

## Scope and decisions
R4 requires exact principal/model filters for authorized Usage/Audit JSON and CSV. URLSearchParams replaces lone UTF-16 surrogates with U+FFFD, silently selecting a different identifier. Reject malformed UTF-16 before serialization; preserve valid Unicode scalar values, including literal U+FFFD, non-BMP characters and combining sequences. No normalization, trimming, new IAM grants or endpoint changes.

## Implementation and TDD
First run public-client regressions demonstrating malformed principal/model filters reach the request port. Add one browser-safe scalar-string predicate before Usage JSON/CSV and Audit JSON/CSV serialization. Cover lone surrogates, valid pairs, Deny and unavailable responses. Run focused suites, strict typecheck, lint, document checks and full check; report host failures separately. Preserve frontend entry ownership. Require exact-head CI and independent formal approval before merge. Stacked on PR970.

## Remaining gates
No default activation or deployment. Native browser/company IdP login, installed PostgreSQL, approved live provider calls and operator handoff are not certified.

## Evidence and links
Final unchanged-source regression: 26 passed / 6 failed with real denied-versus-invalid_query assertions. Initial test draft incorrectly expected non-ASCII Audit principal acceptance; corrected that expectation without changing existing contract. Green: 81 focused tests and one signed synthetic HTTP/PGlite integration pass. See [contract](../../contracts/history-exact-unicode.md), [PRD](../PRD.md), [architecture](../architecture.md) and [acceptance](../acceptance.md).

Final expanded focused run: 87/87 passed, zero skips, including canonical HTTP history/page-size/account-navigation regressions. Strict full TypeScript and pinned OpenRouter schema checks pass; repository lint exits zero with existing 42 warnings and 174 infos. The host npm wrapper cannot start (missing walk-up-path), so npm run check is blocked, not passed. Prior PR970 full-suite result is 9791 passed, 43 failed, 1 skipped; retain that separate host-limited evidence, including SIGKILLs, rather than hiding it behind focused success.
