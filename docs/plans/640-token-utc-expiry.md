# Readable proxy-token expiry (#640)

1. Keep the existing exact Unix-millisecond contract and confirmation. Accept an additional explicit UTC ISO input (YYYY-MM-DDTHH:mm:ssZ or exactly three fractional digits), without guessing local timezone, duration, clock or server policy.
2. Reject invalid calendar dates, missing timezone, offsets, whitespace, negative/noncanonical/unsafe integers before transport. Round-trip calendar input to prevent Date normalization. Preserve every existing valid Unix millisecond value, even outside the Date display range.
3. RED/GREEN: parser boundaries; panel review without mutation, exact confirmed payload, invalid-date no request, Cancel/dispose and existing mutation/lifecycle regressions. Show UTC and exact milliseconds on review where representable.
4. Do not change authority, grants, server lifetime enforcement, sessions, entry/nav, storage, routing or activation. Port/DOM tests are not installed browser/IdP/provider evidence.
5. Require exact-head full CI and independent formal approval before dependency-ordered merge.

## Parent reconciliation (2026-11-20 05:00 KST)

Integrate existing #963 with current #962 exact 54c835e96c3b11454157facd3af0bff94bf5a093 before extending expiry work. Preserve destination-owned cancellation, current Account identity handoff, authorization and exact server lifetime validation; no session/runtime/schema/activation changes. Inspect source conflicts, run bounded real-HTTP issuance success/denial/audit-failure plus UTC panel and Account/Operations regressions, and exercise browser input/review against the integrated bundle. Integration evidence is not new original-source RED or installed/company-IdP/native-PG/provider acceptance. Keep draft and all dependency/exact-head approval gates.

### Reconciliation evidence

No source conflicts. Integration first reproduced five inherited lifecycle test failures caused by the newly changed accessible expiry label; updated those controls to the UTC label. Bounded focused suite then passed 99/99, zero skipped, including real signed-JWT/migrated-PGlite loopback Account issuance success, fresh Deny, failed mandatory audit and exact persisted UTC milliseconds, plus issued-token revocation. Full lint, document/fixture checker, compatibility pins and explicit Operations browser bundle pass. Standard npm typecheck and one bounded direct TypeScript attempt were both killed (exit 137); no local full-check/typecheck pass is claimed.

An isolated browser harness uses the integrated Operations module and actual synthetic-token/PGlite HTTP service on local port 18798. Initial process disappeared; bounded replacement started. Chromium showed Aw, Snap! error code 9 and page tooling timed out, so no fresh successful browser acceptance is claimed. No browser/display process was restarted or killed. Local harness URL is not deployed/external access or company-IdP/native-PostgreSQL/provider acceptance. Exact-head full CI and independent approval remain pending.
