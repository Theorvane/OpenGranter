# Delegated function stream chunk validation

## Issue and problem

- Issue: #344, release gate #116. The delegated text decoder rejects every tool
  delta. Streamed function workflows need a separately validated internal boundary
  before sequence assembly and client delivery can be enabled safely.
- The cached official ChatStreamToolCall requires index and optionally supplies
  nonnullable id, type:function, function.name and function.arguments. Empty/partial
  strings are fragments, not complete invocations. Installed SDK agrees.

## Scope and expected behavior

- Add a separate internal function-stream decoder reusing existing chunk envelope,
  authorized model/alias, metadata, reasoning/refusal, usage and fixed-error gates.
- Validate tool_calls arrays with zero to 128 entries and safe integer indices
  zero to 127, unique per chunk. These are explicit local limits, not source bounds.
- Preserve optional field presence, empty strings and argument fragments exactly;
  type if present must be function. Reject null/malformed/unknown fields and freeze
  arrays, records and function objects. No parsing or execution of argument text.
- Accept tool_calls finish only in the new decoder. Usage chunks cannot carry any
  tool_calls field, including empty, so data cannot disappear silently.
- Existing text decoder/public HTTP/provider stream guards stay closed to tools.
  No routing/IAM/secret/audit/usage expansion. #116 remains open.

## Design

- Share envelope implementation behind two typed decoder entry points. The new
  payload type extends delta/usage finish reasons and adds optional tool fragments.
- Per-chunk validation cannot establish stable IDs/names, accumulated arguments,
  complete calls or tool/finish consistency. Those require later sequence work.
- Source v18 tracks the tool_calls reference but not the transitive tool definition;
  no pin update or full conformance claim. No domain/ADR decision is needed for
  this reversible internal preparation step.
- Update PRD, architecture, acceptance, compatibility and chunk contract.

## TDD plan

- First meaningful red: new decoder import/function is missing. Then fragmented,
  interleaved/empty/terminal tool chunks retain exact frozen values and alias.
- Deny wrong model/multiple choices, legacy/server tools, bad indices/counts,
  duplicates, malformed/unknown/null fields, tool-bearing usage and unsafe finish.
- Fixed errors do not expose call data or provider errors. Existing text decoder,
  SSE consumer, HTTP/SDK/IAM/persistence/accounting/cancellation remain green.
- Smallest shared decoder change, focused tests, format and npm run check.

## Delivery

- Issue/plan, red/green, checks, exact-head AI review, required CI and human merge.
- Main risk is accidentally enabling tools in the text path; explicit negative
  regressions preserve that guard. Rollback removes the unused internal entry point.
- Assembly, sequence lifecycle, streaming requests/history, HTTP SSE, accounting
  integration, transitive drift pin and external-client workflows remain open.

## Verification evidence

- Initial missing-entry-point red; behavior red against text-only delegation:
  1 pass, 3 expected failures for supported fragment/finish projection.
- Focused fragment/text/sequence/consumer/HTTP/invoker/SDK green: 94 passes.
  Installed SDK agrees on field optionality; its broader index bounds remain
  explicit. Bytewise SSE framing preserves Unicode argument fragments exactly.
- Full npm run check: strict types/lint passed; 1,558 tests passed with one existing
  PostgreSQL skip; planning/contracts/fixture scan and offline pin integrity passed.
- Existing public tool-stream rejection, IAM/limits/persistence/cancellation and
  privacy/accounting remain green. Evidence-only plan passes the planning checker.
