# Delegated function stream sequence validation

## Issue and problem

- Issue: #346, release gate #116. #344 validates individual function fragments but
  cannot prove stable complete calls, finish consistency or complete termination.
- Public tool streaming remains closed until sequence, transport, accounting and
  client delivery are connected. This increment implements the internal sequence.

## Scope and expected behavior

- Accumulate exact argument strings by index; ID/type/name are supplied metadata,
  stable when repeated. Do not concatenate names/IDs or parse/execute arguments.
- Completed tool calls require dense indices from zero, one to 128 unique nonempty
  IDs/names, supplied function type and at least one supplied argument fragment.
  Tool calls require tool_calls finish; no calls require ordinary supported finish.
- Reject substantive refusal combined with calls, even across different events.
- Stable response ID/model, terminal then matching usage then DONE are required;
  incomplete/misordered/error paths retain safe possibly-billed failure semantics.
- Retain at most 1,048,576 UTF-16 units across unique ID/name and accumulated
  arguments, an explicit local budget. Use private state and clear on failure/end.
- Completed calls are response content; never audit/ledger metadata. No HTTP,
  transport, routing, IAM, credential or accounting expansion. #116 stays open.

## Design

- Add a separate function sequence using decoded #344 events and shared safe
  sequence failure/usage snapshot types. Preserve existing text sequence unchanged.
- Follow documented Chat Completions accumulation: metadata is stable and arguments
  append by index. Repeated equal metadata is allowed; conflicts reject locally.
- Local dense/completeness/budget gates are stricter than schema optional fragments.
  No claim that every provider emits these shapes; broader behavior stays open.
- No transcript of ordinary content/reasoning/refusal is retained. Private call
  state is cleared at terminal failure, upstream error and finish. Successful calls
  are deeply frozen and exposed only in the explicit internal response outcome.
- Update PRD, architecture, acceptance, compatibility and sequence contract. Pin
  v18 and transitive tool-definition drift gate remain unchanged; no ADR/domain edit.

## TDD plan

- New sequence regression first fails because its implementation is missing. Interleaved calls,
  exact Unicode/empty arguments, late metadata and repeated equal metadata complete.
- Reject conflicts/duplicates/sparse/incomplete calls, mismatched finish/refusal,
  retained-content budget overflow, wrong identity and every terminal-order failure.
- Usage missing/invalid/categories and metadata remain snapshots. Error/failure/state
  serialization do not expose calls; finalized instances cannot emit success again.
- Existing chunks/framing/sequence/consumer/HTTP/SDK/security tests stay green.
- Smallest independent implementation, focused tests, format and npm run check.

## Delivery

- Issue/plan, red/green evidence, full checks, exact-head AI approval, required CI
  and human-account merge. No public tool streaming claim.
- Risks: local bounds reject broader provider sequences; response-bearing outcomes
  must stay outside operational records in future integration. Rollback removes
  internal preparation only. Transport/SSE/accounting/client workflows remain open.

## Verification evidence

- New public sequence regression red: missing implementation module, before coding.
- Green: all 10 sequence scenarios pass; focused chunks/sequence/consumer/HTTP/
  invoker suites pass 75 tests. Interleaving, stable metadata, exact opaque/Unicode/
  empty arguments, 128 calls and aggregate retained-content bounds remain covered.
- Full npm run check passes strict types/lint, 1,568 tests with one existing
  PostgreSQL skip, planning/contracts/fixture scan and offline pin integrity.
- Existing public tool-stream guards, IAM/limits/persistence/cancellation and
  privacy/accounting stay unchanged. Evidence-only plan passes planning checks.
