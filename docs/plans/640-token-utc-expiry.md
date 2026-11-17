# Readable proxy-token expiry (#640)

1. Keep the existing exact Unix-millisecond contract and confirmation. Accept an additional explicit UTC ISO input (YYYY-MM-DDTHH:mm:ssZ or exactly three fractional digits), without guessing local timezone, duration, clock or server policy.
2. Reject invalid calendar dates, missing timezone, offsets, whitespace, negative/noncanonical/unsafe integers before transport. Round-trip calendar input to prevent Date normalization. Preserve every existing valid Unix millisecond value, even outside the Date display range.
3. RED/GREEN: parser boundaries; panel review without mutation, exact confirmed payload, invalid-date no request, Cancel/dispose and existing mutation/lifecycle regressions. Show UTC and exact milliseconds on review where representable.
4. Do not change authority, grants, server lifetime enforcement, sessions, entry/nav, storage, routing or activation. Port/DOM tests are not installed browser/IdP/provider evidence.
5. Require exact-head full CI and independent formal approval before dependency-ordered merge.
