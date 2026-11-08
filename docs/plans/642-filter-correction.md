# Correct usage filters without widening scope (#642)

1. Preserve submitted raw filter drafts when validation fails, including impossible UTC dates and page sizes. Do not erase a rejected range into a visually empty field that can silently broaden a subsequent query.
2. Add explicit Clear filters to the existing usage screen. It starts a fresh self-scoped page with no principal/model/time/cursor and retires prior downloads and navigation. No new API, privilege, public entry, session, runtime or schema.
3. Establish RED/GREEN for repeated invalid submission without HTTP, correction with exact UTC bounds, explicit reset, stale controls and authority clearing. Use actual loopback HTTP where applicable; structural DOM is not native-browser acceptance.
4. Run focused regression, full typecheck/lint/planning/compatibility and full check. Require exact-head CI and formal independent approval before merge.
