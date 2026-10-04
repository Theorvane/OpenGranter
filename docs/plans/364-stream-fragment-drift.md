# Streamed function fragment schema drift selection

## Issue and problem

- Issue: #364; release gate #116 remains open. The selected delta references ChatStreamToolCall without tracking its target,
  allowing nested fragment drift to pass.

## Scope and expected behavior

- Extend selected streaming definitions from four to five by pinning the entire ChatStreamToolCall definition, including its inline function name and arguments. Keep 23 request fields and all other selected maps unchanged.
- Preserve verified canonical source provenance from the cached 2026-10-04 official document; version 19 records the expanded projection, not a fresh full-source comparison.
- Detect unchanged-parent nested structural drift and malformed or rehashed stale/extra/missing maps; editorial annotations remain ignored. Runtime bounds and exact-key rules remain local restrictions without invented source limits.
- No service, IAM, audit, usage or request behavior changes. Named external-tool and broader structural coverage remain open under #116.

## Design

- Extend the exact selected stream map with the full transitive fragment target.
- Preserve text and public HTTP guards, fixed destinations and immutable capture.
- Version 19 changes only the selected projection and its digest. No new domain terms
  or costly decisions. Further external-tool and unselected-schema coverage remain open.
- Update PRD, architecture, acceptance, compatibility and a dedicated contract.

## TDD plan

- Add projection regressions first: the absent target and unchanged-parent nested
  drift are the expected red.
- Cover success, denial, malformed data and sanitized failures; preserve existing
  schema coverage. Make the minimum implementation and run focused tests.
- Run format and full npm run check before review.

## Delivery

- Issue and plan before code; record red/green evidence in PR. Exact-head review
  by sjungwon03-ai and both CI checks precede sjungwon03 squash merge.
- Function fragments are response content, never operational audit/usage data.
- Missing usage remains unknown; do not claim complete #116 compatibility.

## Verification evidence

Pin version 19 adds the complete transitive ChatStreamToolCall definition to the exact selected stream map. Parent references cannot hide index/id/type or inline function name/arguments drift. All previous selections and the verified cached canonical source digest/retrieval date remain unchanged; no fresh retrieval is claimed. Runtime caps remain local restrictions.

Red: the added projection test found the target undefined and the nested-drift test incorrectly returned true. Green: all 114 focused schema tests pass, including malformed targets, annotations, exact-map/stale-pin checks and nested drift. No service, IAM, audit or usage behavior changes. Named external applications and broader source coverage remain open.


Full npm run check passes strict types, lint, 1657 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
