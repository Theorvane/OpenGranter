# Exact request trace integration evidence

- Base: PR759 a331c8bb37f116ed9234b4d23b1ed4fc954c73a1; dependent branch, not independently mergeable into main.
- Original frontend a1bbc43468651df7888d7357b426e4de72e566b4: selectively applied only request-filter production/test delta. Original UI ownership retained. No unrelated ancestry/session/schema/activation.
- Original request-filter RED: 0 pass / 5 fail, /tmp/og-1500-red.log. Focused original GREEN: 49 pass / 0 fail / 0 skip, /tmp/og-1500-green.log.
- Source and built workspace use signed test SSO JWT, real loopback HTTP and migrated PGlite plus explicit test-only SSO audit candidate schema. Added exact request trace from explicit principal + model, CSV filter retention and durable audit checks; foreign same-ID attempts remain excluded. Initial two new acceptance failures were a test button label typo; corrected suite 18 pass / 0 fail / 0 skip, /tmp/og-1500-workspace-corrected.log. Original failure log retained.
- Existing SQL/filter tests cover exact case-sensitive matching, model/time/principal intersection, cursor paging, JSON/CSV, malformed filters, off-request lookahead and mandatory-audit failure. No stronger deployment claim.
- Previous PR759 local full suite terminal: 9172 pass / 7 fail / 1 skip (SIGKILL workers), /tmp/og-1430-fullcheck.log; CI6 SUCCESS, no formal approval. Not erased by this focused result.
- Native browser unavailable: browser_navigate and computer_observe both report Team Computer screen still being released. No browser PASS. No browser/display restart attempted.
- Real IdP/session approval, installed deployment/provider/budget and independent formal reviews remain gates.

Final post-format focused suite: 67 pass / 0 fail / 0 skip (/tmp/og-1500-final-focused.log). Typecheck PASS; lint PASS with existing warnings/infos; scripts check PASS; six pinned compatibility checks PASS. Full exact-head suite will be attempted serially to limit competing PGlite workers and reported separately.
