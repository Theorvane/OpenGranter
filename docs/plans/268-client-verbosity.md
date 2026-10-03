# Delegated verbosity controls

## Issue and problem

- Issue: [#268](https://github.com/Theorvane/OpenGranter/issues/268), release gate #116.
- The gateway rejects the documented OpenRouter verbosity field before routing.

## Scope and expected behavior

- Accept low, medium, high, xhigh and max on both chat bases for delegated nonstream and text-stream requests. Optional null is a local omission allowance; no default is injected.
- Reject unknown strings/types before routing; capture valid supplied values once before credential access. Keep authorized model/provider restrictions, IAM, limits, accounting, audit and safe errors unchanged.
- Native direct adapters reject non-null verbosity before credentials until native mappings are implemented; omission/null preserve existing behavior. Tool history remains supported under existing nonstream rules.

## Design

- Add a narrow string union and validator, client allowlist/projection, shared delegated request capture/projection and explicit direct-adapter capability rejection.
- The [official parameter documentation](https://openrouter.ai/docs/api_reference/parameters), checked 2026-10-03, lists five values and conventional medium default. Current official ChatRequest and pinned OpenRouter SDK lack this field. Do not fabricate source pin or SDK forwarding claims. OpenAI raw JSON forwarding is separately tested.
- Delegated upstream decides model support; direct OpenAI/Anthropic/Gemini mappings and provider capabilities remain open. No new domain decision or ADR; no pending dependency. Repository grill-with-docs fact audit checks these boundaries.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/client-verbosity.md).

## TDD plan

- First public request with verbosity should fail red with 400 instead of 200.
- Cover all values, null/omission, invalid types/case, direct pre-secret rejection, immutable capture, combined parameters/tool history, both delegated modes, SDK forwarding/stripping, IAM/Deny/limits and required ledger/audit failure.
- Add minimum validation/projection; focused tests then npm run check.

## Delivery

- PR includes red/green and full-check evidence; CI and approval required.
- No migration. Rollback removes this optional field. SDK/source and native mapping gaps remain explicit; release gate #116 remains open.

## Verification evidence

- Red: focused public request failed with 400 instead of 200; delegated scalar capture test reproduced omitted high verbosity.
- Green: 14 focused tests pass across exact values/null/omission, invalid early rejection, direct capability rejection, immutable single capture, combined sampling/tool history, both HTTP bases and delegated modes, security/accounting gates and SDK socket behavior.
- npm run check passes 1,061 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and offline pin integrity.
- Actual OpenAI SDK forwards the raw field; pinned OpenRouter SDK strips it. Official source selection and direct native mappings remain gaps. Preserve pending sampling controls during integration.
