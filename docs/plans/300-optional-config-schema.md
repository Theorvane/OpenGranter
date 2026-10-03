# Preserve omitted JSON-schema configuration schema

## Issue and problem

- Issue: #300; release gate #116 remains open.
- Pin v16 and both SDKs permit schema omission in ChatJsonSchemaConfig; runtime
  rejects it, blocking structurally valid external-client requests.

## Scope and expected behavior

- Accept valid named json_schema configs with schema omitted; preserve omission
  exactly on direct OpenAI and delegated OpenRouter, including existing streams.
- Supplied schema must still be a bounded plain JSON object. Null, boolean,
  array, explicit own undefined and other malformed values remain rejected.
- No empty schema/default or output-conformance guarantee is fabricated.
- Preserve name/config validation, immutable capture, native Anthropic/Gemini
  pre-secret rejection, IAM/Deny/limits, required audit/usage and safe errors.

## Design

- Make the typed schema field optional and check the supplied object only when
  it is an own field on the already-captured JSON config.
- Update the format contract, PRD, architecture, acceptance and compatibility
  inventory; pin v16 already tracks the official optional required-list shape.
- Retain strict omission/null/boolean and optional description without defaults.
- Alternatives: injecting {} changes client semantics; blanket rejection conflicts
  with the pinned schema. Exact omission is the compatible reversible behavior.
- No new domain terms or ADR; native mappings, local output enforcement and full
  #116 conformance remain open dependencies.

## TDD plan

- First HTTP name-only/optional config cases expect 400 instead of 200.
- Both SDK socket bases, delegated nonstream/stream, pre-secret mutation and
  supplied empty-object distinction; malformed supplied fields and native denial.
- Authentication/model-provider IAM/limits, required persistence and upstream
  failures keep safe delivery and accounting; operational metadata excludes text.
- Focused tests then npm run check; no source pin change or live refresh required.

## Delivery

- Issue/plan, tests/red, minimal guard/green, full checks, exact-head review and CI,
  authorized account merge and main synchronization.
- Risk: providers may reject semantically insufficient configs; safe upstream
  failure accounting remains in place. Gateway does not assert output compliance.
- Record red/green and final checks in the PR; rollback by reverting the guard.

## Verification evidence

- Initial public HTTP/SDK red: 22 passed, 10 expected failures (schema omission
  rejected before forwarding, IAM/limit evaluation or native rejection).
- Focused format/function-tool/schema-drift green: 144 passed, no failures.
- SDK sockets verify omission on both bases, supplied-object parity and existing
  delegated streaming with one final usage event per request.
- Source pin/projector are unchanged; full npm run check results are in the PR.
