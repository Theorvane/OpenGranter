# Attempt billing evidence (#642)

1. Original PRD usage review requires per-attempt cost and uncertainty. Inspect attempt currently omits total tokens and exact cost amounts: its price-version/billing-source fields do not explain zero versus unknown, nor possibly billed failed attempts. Add existing content-free fields consistently in table and request correlation.
2. Preserve the explicit usage-attempt-details contract exclusion of credential IDs and policy versions. An initial uncommitted exploration of those fields was rejected by the existing privacy test and discarded, not approved as scope. No new API, session or policy authority.
3. RED/GREEN: source and supported browser artifact must expose exact decimal amount/currency, separate estimated and reported values, zero versus missing, usage status and explicit billing/duplicate flags. Unknown response properties, credential references and policy versions stay hidden. No extra requests; expiry erases details.
4. Run focused integration/build/lifetime tests, typecheck, full checks, dependent PR, exact-head independent review and CI. No native browser/session/installed-provider success claim.
