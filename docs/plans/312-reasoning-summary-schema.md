# Reasoning summary request schema drift

## Issue and problem

- Issue: #312; release gate #116 remains open.
- Runtime #310 forwards summary-only reasoning configurations, but pin v17 omits
  the reasoning request field and referenced summary enum, missing their drift.

## Scope and expected behavior

- Add exactly ChatRequest.reasoning and ChatReasoningSummaryVerbosityEnum;
  matching reviewed pin/projector version 18 selects 23 fields and 14 definitions.
- Track whole inline reasoning structure, summary reference, nullable named enum,
  constraints, required/default data and extensions with unchanged parents.
- Ignore editorial annotations while preserving annotation-named properties and
  literal defaults. Reject missing/malformed sources, rehashed invalid exact maps
  and versions 1..17. Preserve every previous selected structure.
- No runtime/provider/IAM/secret/audit/usage behavior change. Whole inline effort
  selection does not enable nested effort or additional reasoning controls.

## Design

- Extend explicit field/definition allowlists and exact version gate.
- Keep independent official-shaped request/enum fixtures, mutation cases and
  provenance tests; do not reconstruct expected structures from the pin alone.
- Explicitly fetch the bounded credential-free fixed-host source, compare all old
  selections and review any source digest change before replacing the pin.
- Update drift/summary contracts, architecture, acceptance and compatibility
  checkpoint. PRD runtime scope and domain vocabulary remain unchanged; no ADR.
- Open: native summaries, nested controls and complete JSON-instance/external-client
  certification. Structural selection is not a claim of model capabilities.

## TDD plan

- First exact selection, unchanged-parent drift and old-version cases fail before
  projector changes; include source absence/malformed and rehashed map corruption.
- Verify enum/null/type/default/extension, inline required and summary references,
  annotation omission and literal data preservation.
- Minimal field/enum/version additions, reviewed pin refresh, focused tests,
  npm run check and explicit compatibility:drift.

## Delivery

- Issue/plan, tests/red, projector/pin/green, full checks, exact-head review/CI,
  authorized sjungwon03 merge and clean main synchronization.
- Risk: accepting unnoticed drift; compare all previous selections and record
  source/projection digests. Roll back projector and matching pin together.
- Publish evidence and remaining #116 gates in PR.

## Verification evidence

- Initial red: 101 passed, 9 expected failures (unselected field/enum, undetected
  drift, malformed selections and old-version acceptance). Focused green: 110 passed.
- Explicit fixed-source refresh preserves every version-17 selected structure and
  canonical source digest:
  b818343bf2417ad8abdef9ceeea45140db6e06670d7fa54356591cd3304dd3f5.
- New projection digest:
  70f384c2ab341bdca6a0ae570938540c714d9e89fec499e7e748bfba33f096a3.
- Full check/live comparison and exact-head review/CI results are reported in PR.
- Final npm run check: 1439 passed, one existing optional PostgreSQL integration
  skip; strict typecheck/lint, planning/links/contracts/secret scan and offline pin
  integrity passed. Explicit compatibility:drift passed against official source.
