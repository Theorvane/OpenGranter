# Nullable optional chat controls

## Issue and problem

- Issue: [#140](https://github.com/Theorvane/OpenGranter/issues/140), compatibility parent #116.
- The official ChatRequest permits null token maxima and sampling fields; the supported local subset currently rejects those otherwise compatible calls.

## Scope and expected behavior

- Treat null max_tokens, max_completion_tokens, temperature and top_p as omission at both client paths and all four adapters. Do not send explicit null upstream or invent sampling defaults.
- Resolve token aliases after normalization; preserve numeric equality/conflict handling, limits, output caps on supplied numeric limits and existing omission behavior (including required Anthropic configured output maximum).
- Preserve strict validation for other malformed values, non-null native sampling ranges, n and stream. Capture before asynchronous credential lookup.
- No routing, IAM, budgets, audit or usage policy changes. Streaming/tools, model omission and complete conformance remain out of scope.

## Design

- Normalize sampling primitives at HTTP/adapter boundaries before existing validators. Normalize both maxima inside shared resolution before validation/conflict comparison.
- Keep ChatRequest as the normalized internal number-only type; external unknown input can contain null but adapters never pass it into internal/native payloads.
- Null is an absence sentinel, not a literal native parameter value. Official sources: [OpenAPI](https://openrouter.ai/openapi.json) and [parameters](https://openrouter.ai/docs/api_reference/parameters).
- Update output/sampling contracts, PRD, architecture, acceptance and compatibility inventory. No unresolved product decision is settled.

## TDD plan

- New public-boundary cases first: null/omitted controls, null+number aliases, numeric caps, mixed stop/sampling settings, captured null during secret mutation and no null upstream.
- Both HTTP paths and four adapters: normal calls, IAM/limit/required audit denial, safe upstream failure accounting and remaining malformed-field rejection.
- Record red, normalize minimally, green and revise old invalid-null fixtures to match the changed contract. Keep every other invalid value and expected denial.
- Run focused Biome/type checks and npm run check.

## Delivery

- No migration or new dependency. Local null requests now reach the established omission path; only accepted input expands.
- Optional omission does not introduce a new output budget or native capability claim. Report tests and remaining compatibility gaps in the ready PR.

## Verification evidence

- Red: fifteen new public adapter/HTTP cases produced fourteen failures and one pass against the prior implementation, reproducing rejection of nullable requests.
- Green: sixteen cases pass after minimal normalization, including native omission/defaults, numeric caps and alias pairs, pre-secret capture, both HTTP paths, unchanged denials and safe failure accounting.
- Four prior control suites no longer classify null as invalid; all non-null malformed/range/conflict cases are preserved.
- Focused Biome with `--error-on-warnings`, strict TypeScript and diff checks passed. Before latest-main integration, npm run check passed with 645 tests and one optional external PostgreSQL case skipped; planning/link/contract/fixture checks passed.
