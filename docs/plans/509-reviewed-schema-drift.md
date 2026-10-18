# Review official request and model-response schema drift

## Issue and problem

- Issue: #509; follow-up to #508, with full compatibility tracked by #116.
- The fixed official OpenAPI comparison detected six chat schema additions and seven model-response legacy nullable marker removals on 2026-10-18. Existing pins correctly report drift.

## Scope and expected behavior

- Review the source independently, then advance request pin v31 to v32 and model-response pin v1 to v2 with current provenance.
- Track optional alignment and safeguard_results references on ChatResult and ChatStreamChunk, and optional boolean defer_loading at both function-tool declaration levels.
- Preserve explicit nullable number/integer type arrays after removal of redundant nullable:true markers on five default parameters and two top-provider counters.
- No runtime parser, provider, IAM, secrets, usage, limits or audit behavior changes. Structural tracking does not enable deferred tools, alignment plugins or safeguard output. Query and count pins remain unchanged.

## Design

- Keep the previously selected definition sets and normalization rules. Inspect Alignment (which references AlignmentCallRecord) and ArmorSafeguardResult, but retain their references as strings under the existing bounded-selection contract. Their internal bodies remain outside detection until explicitly selected in follow-up work; no remote reference fetching or automatic expansion.
- Independently assert every new field and every retained nullable type. Reconstruct exact prior projections and digests so unrelated source changes cannot hide in a pin refresh. Preserve existing historical migration assertions through the reviewed v31 reconstruction.
- Update the schema contracts and compatibility status. No glossary or architectural decision changes are necessary: this applies the existing structural-tracking scope.
- Dependencies: #510 separately adds the count pin and may merge independently; do not depend on its unapproved head.

## TDD plan

- First add exact independent pin-shape/version, old-version rejection, historical digest and changed-field drift tests; run them against existing pins to observe the expected failures.
- Cover source reference changes, boolean type/optionality, explicit nullability and restoration of legacy markers; demonstrate that unselected new target bodies stay outside detection.
- Extend controlled-download CLI probes for these specific changes and stale versions, with safe output and unchanged pin bytes.
- Advance only the two reviewed pin versions and validators; retain all prior selected targets. Run focused schema/CLI tests, offline integrity, a fresh bounded fixed-host live comparison and npm run check.

## Delivery

- Record red/green evidence, source and projection digests, unchanged unrelated pins and complete validation in the PR.
- Risk: future changes solely within unselected alignment/safeguard target bodies are not detected; runtime support and full #116 remain open. Roll back the paired validator/pin changes together if needed.

## Verification evidence

- Red: the new independent reviewed-schema suite against the original pins/validators ran 29 cases, with 11 expected failures and 18 passing. Failures included old versions, missing new shapes, retained legacy markers and old-version acceptance.
- Green: reviewed/chat/model-response/controlled CLI suites passed all 386 cases. The separate probability-schema suite passed all 28 cases after updating its current-version assertion and stale-version loop; existing selected token/group shapes remain unchanged.
- Fresh fixed-host compatibility:drift reports all three selected subsets unchanged. Offline compatibility:check and the planning/link/contract/fixture-secret checker pass. The query pin is byte-identical and CLAUDE.md remains a symlink.
- Initial full gate exposed the separate old-version assertion and an existing SSO shutdown test exceeding its unchanged 15-second deadline under host contention. The version assertion was fixed. No timeout, warning-filter or runtime behavior change is introduced.
- Clean `env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` retry passed: 6,801 cases, 6,800 passed, one optional external PostgreSQL skip, zero failures/cancellations; strict type checking, lint, planning/link/contracts/fixture-secret checks and all three offline pin integrity checks passed. Log: /tmp/opengranter-509-check-retry.log.
