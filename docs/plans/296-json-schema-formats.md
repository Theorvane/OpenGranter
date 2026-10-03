# Bounded JSON-schema response formats

## Issue and problem

- Issue: #296; release gate #116 stays open.
- Structured-output clients currently receive 400 for json_schema formats.

## Scope and expected behavior

- Both bases accept exact json_schema formats with required name (1..64 ASCII
  letters/digits/underscore/hyphen) and schema object, optional string description
  and boolean/null strict. Omission preserves defaults; outer null still rejects.
- Forward captured formats on direct OpenAI/delegated OpenRouter. Unsupported
  direct Anthropic/Gemini reject before credentials without destination changes.
- Snapshot only plain JSON trees, at most 20,000 nodes and depth 64; reject
  accessors, cycles, holes, nonfinite numbers and unsupported objects.
- IAM, limits, required audit/usage, safe errors and refusal/truncation stay shared.
  Schema descriptions never enter operational metadata or errors.
- No local JSON Schema evaluation, URL fetching, repair, prompt rewriting,
  capability selection or additional stream mode is introduced.

## Design

- Extend the shared response-format snapshot used at HTTP/provider boundaries.
- Reuse bounded function-tool JSON snapshot traversal with an exported object
  wrapper; strengthen array descriptor capture so accessor elements reject.
- Add a pre-secret unsupported native-provider guard for json_schema.
- Update format contract, PRD, architecture, acceptance and compatibility inventory.
- Official source: https://openrouter.ai/docs/guides/features/structured-outputs
  and installed SDK 1.4.18 ChatJsonSchemaConfig. SDK allows omitted schema; this
  implementation deliberately requires an object. Referenced schema drift,
  native mappings and full instance conformance remain explicit dependencies.
- No new domain terms, irreversible decisions or unresolved product options.

## TDD plan

- Public HTTP forwarding cases should fail 400 instead of 200 before coding.
- Actual SDK sockets, strict omission/null/boolean, Unicode/nested literal data,
  immutable capture during secret awaits, malformed/bounded JSON and names.
- Denial/limit/audit/usage/transport failures, unsupported native providers and
  operational privacy. No extra credential requests for schema references.
- Focused tests then npm run check; report red/green evidence in the PR.

## Delivery

- Issue and plan, tests/red, minimal implementation/green, required full checks,
  exact-head review as sjungwon03-ai, approved green merge as sjungwon03.
- Risk: schema forwarding cannot guarantee provider/model compliance; document
  that limitation and keep #116 open. Rollback is a revert of this format subset.

## Verification evidence

- Initial public HTTP/SDK red: 15 passed, 9 expected failures (400 instead of
  forwarding/supported-provider success and native unsupported 502).
- Shared function-parameter array regression red on the original array read:
  0 passed, 1 failed (accessor accepted and dispatched instead of rejecting).
- Focused green: 38 passed, including both SDKs and delegated streaming.
- Final npm run check results are recorded in the PR.
- Referenced JSON-schema definition drift is not added to the existing source
  projection here; that explicit conformance gap remains open under #116.
