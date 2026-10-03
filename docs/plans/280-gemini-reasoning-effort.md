# Map reasoning effort to direct Gemini thinking levels

## Issue and problem

- Issue: [#280](https://github.com/Theorvane/OpenGranter/issues/280), release gate #116.
- Direct Gemini rejects the client effort field despite native thinkingLevel support.

## Scope and expected behavior

- Map minimal/low/medium/high unchanged to generationConfig.thinkingConfig.thinkingLevel for nonstream requests through both bases. Null/omission inject no thinking config/default.
- Reject none/xhigh/max before credentials; do not disable thinking, compute budgets or invent nearest-level aliases. Anthropic non-null effort remains unsupported.
- Capture once before credentials and preserve generation settings, fixed registered destination, IAM/Deny/limits/audit/usage and safe possibly-billed failures.
- Reject returned thought:true or malformed thought flags rather than concatenating private thinking into visible text. Preserve ordinary text and optional false flags.
- Direct streams, tool/thought signatures/history, richer reasoning responses, thinking-token details and Gemini 2.5 budgets remain out of scope.

## Design

- Extend the native capability guard and existing Google generationConfig condition/projection only. Add a safe native response guard for unsupported thought parts.
- [Google thinking REST documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking) declares the four lowercase native levels. Models support different subsets; Gemini 2.5 needs budgets. No model-name inference or capability certification.
- OpenRouter documents xhigh to high for Gemini, but this bounded direct subset deliberately preserves only exact names. Native model rejection remains safely accounted.
- Anthropic is unresolved: official budget and output-effort paths differ, and output effort overlaps existing verbosity. No implicit precedence or default budget decision; no glossary/ADR changes.
- Depends on [PR #279](https://github.com/Theorvane/OpenGranter/pull/279) and #275. Rebase only this issue's commit after dependency merges.
- Update PRD, architecture, acceptance, compatibility and [contract](../../contracts/client-reasoning-effort.md).

## TDD plan

- Public Gemini request initially fails with 502 instead of 200. A thought-part regression initially exposes a thinking part as visible text instead of failing safely.
- Cover four levels/null/omission, unsupported/invalid values, no defaults, captures, native controls/caps, safe hidden-thought failures, model rejection, IAM/Deny/limits/required audit/ledger and real OpenAI SDK socket serialization.
- Smallest native guard/projection changes, focused tests, npm run check and integrated control regressions.

## Delivery

- PR records red/green, checks, dependency and material model/response limitations.
- No migration; rollback restores Gemini non-null rejection. Do not claim complete compatibility.
- Require CI and approval before merge.

## Verification evidence

- Red: valid Gemini effort returned 502 instead of 200. Independent native thought:true response returned 200 instead of safe 502 when effort was omitted.
- Green: 31 focused tests pass, including seven new Gemini tests and prior delegated/OpenAI regressions. Both public bases, four levels/null/omission, caps/control coexistence, pre-secret rejection/captures, hidden/malformed thought failures, required accounting/audit and actual SDK sockets are covered.
- npm run check passes 1,078 tests with one existing optional PostgreSQL skip, strict types, lint, document/link/contract/fixture checks and offline schema integrity.
- Primary Google REST docs confirm the lowercase values and model restrictions. Anthropic mapping remains explicit unresolved work; no new glossary term or ADR decision.
- Rebase only this issue's commit after dependency merges and revalidate.
