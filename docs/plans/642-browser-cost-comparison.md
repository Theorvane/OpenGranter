# Validated browser cost comparisons (#642)

1. Close the authorized JSON-to-browser-client gap: retain exact estimated-versus-reported cost comparison in ready usage rows, without trusting server extensions or inventing invoice reconciliation.
2. Reuse the existing validated JSON projection. Support older JSON responses without the additive field; recompute it from allowlisted cost metadata. Preserve original amounts, unknown usage and independent duplicate/billing flags.
3. Before implementation prove RED for tiny signed decimal differences, missing/partial/mismatched currencies and forged fields. Exercise the real signed-SSO/PGlite/Fetch-to-client path including audit failure, and execute a browser-platform compiled transport module.
4. Run focused regressions, typecheck, lint and repository checks. Require exact-HEAD formal review and all mandatory CI before merge. No DOM/session/IdP/policy/DDL/runtime activation or deployed-browser certification.
