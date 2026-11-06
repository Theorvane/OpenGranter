# Current-page audit request trace (#642)

1. Extend only the disconnected audit metadata screen. Do not connect the SSO workspace, obtain authority, register endpoints or enable retention. Existing audit:Read/read-audit remains unchanged.
2. Add expandable request groups from the validated current page using exact principal/request pairs. Preserve first-seen group order, returned event order, bigint IDs and repeats; never infer execution order, completeness or request outcome.
3. Reuse the same text-only credential/policy/allowlisted metadata renderer for the table and trace. Expansion makes no requests. Group nodes belong to the ready page and disappear on read, page change, clear, renewal, denial, expiry and disposal.
4. RED must fail because the actual screen lacks request traces. GREEN covers source and the supported public build, compound-key collisions, HTML-like text, paging, authority lifetime and real HTTP/embedded SQL isolation/read auditing. Native browser is a separate gate.
5. Require exact-head mandatory CI and independent formal approval before merge; retain auth/session/IdP/CSRF/CORS/runtime HOLD.
