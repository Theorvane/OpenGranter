# Current-page usage cost summary (#642)

1. Extend the existing authorized usage ready view, not a new screen or wrapper. Group estimated and provider-reported costs separately by exact currency and add decimal strings without floating-point rounding. Never infer a conversion, missing cost, deduplicated bill or all-pages total.
2. Expose current-page record/cost coverage, partial/missing/invalid token usage and possible-billing/duplicate counts. Render only authorized rows already returned by the existing API, with text-only output. Clear summaries with the existing loading, paging, cancellation, expiry and disposal lifecycle.
3. Establish RED with structural-DOM integration cases for exact mixed-currency costs, real zero versus unknown and summary clearing; implement GREEN and test actual loopback SSO usage HTTP consumption. Existing source-only/session/runtime/schema boundaries are unchanged.
4. Run focused tests, typecheck, lint, planning and compatibility checks. Request independent exact-head review and require all required CI plus formal approval before merge. No installed browser login, deployment or provider billing certification is implied.
