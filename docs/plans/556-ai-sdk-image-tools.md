# AI SDK inline-image tool continuations

## Issue and problem

- Issue: [#556](https://github.com/Theorvane/OpenGranter/issues/556), refs #116.
- Existing actual-client probes measure inline PNG and tool loops separately. Their composition must retain image bytes and correlated history without reusing a previous authorization decision.
- Base: approved PR #555 on 205c50019fceedcbc543dd18e827b47b2febc90b passed all three checks and merged as db2535a. Issue #554 is closed.

## Scope and expected behavior

- Actual pinned generateText and streamText, both chat bases and delegated OpenRouter/managed OpenAI/Anthropic/Gemini, with one inline PNG between two text parts and a two-request function/result loop.
- Capture exact first/native continuation history, registered destination, image MIME/bytes/order and call/result correlation. Every request authenticates, checks current model/final-provider IAM and limits, and has independent usage/audit identity.
- Introduce fresh failed authentication, implicit/model/provider Deny and limit exhaustion after client tools run, plus required usage/outcome-audit failures before and after continuation. Observe actual wire errors/final markers separately from client events or already executed tools.
- No new product behavior, remote downloads, signed Gemini, live vision support, richer media/Output modes, dependency/source-pin/storage changes or complete #116 claim. Jev #7 remains unresolved.

## Design

Reuse existing registered transport fixtures and the bounded actual-client loopback server. Nonstream fixtures provide two parallel correlated tools; streaming fixtures provide one ordinary read tool. Use application-owned Uint8Array PNG data, explicit image/png, an empty-only download hook, maxRetries:0 and abort deadlines. Successful original streams are consumed normally; finite failure probes may inspect response clones.

Extend [client contract](../../contracts/ai-sdk-client-workflows.md), [reproduction](../ai-sdk-conformance.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md) and handoff. Current PRD/architecture already require these controls; no new domain term or costly architectural decision is needed.

## TDD plan

- Run new actual-client cases against approved production code before considering changes. If a defect is reproduced, record the expected failing regression and make the smallest correction. Do not invent a production red/green cycle for passing conformance work.
- Success: exact native initial/continued image history, local tool execution and independent persisted counters/request IDs. Denial: fresh provider Deny prevents the second secret/upstream/limit check while preserving first-attempt accounting.
- Failure: required usage/outcome-audit errors on first or second requests; no false final wire acknowledgment or private operational leakage. Record any local SDK tool/event behavior honestly.
- Run focused SDK/native/image tests and npm run check using the documented CPU-affinity setup.

## Delivery

Add bounded probes, record client accounting/stream limitations, update English contracts/docs and open a ready PR after full validation. Rollback removes tests/docs unless a separately reproduced production defect warrants a correction. Preserve CLAUDE.md as the AGENTS.md symlink and existing source/dependency/storage bytes.

## Verification evidence

- Initial 96 new cases passed against unchanged approved production code; no runtime defect or production red/green cycle is claimed.
- Extended fresh continuation gates to authentication, implicit/model/provider Deny and limit exhaustion. All 160 new cases and the 430-case focused SDK/native/image regression selection passed.
- Exact image/native history and correlated results remain intact through each request. A failed first persistence handoff prevents local execution in these probes; second-request failure or denial cannot undo completed application tools. Streams with a persistence fault withhold actual final usage/DONE even when final text has already arrived.
- Nonstream client summaries still total 10 from two 2/3 steps while the ledger retains the reported 7 per attempt (5 for native Anthropic); streamed fixtures report 5 per attempt. None establishes billed cost.
- Final npm run check passed: 7,945 total, 7,944 passed, zero failures/cancellations and one optional external PostgreSQL skip (~242 seconds). Typecheck, lint, planning/link/fixture-secret checks and all six offline source-integrity checks passed. Existing 42 lint warnings/65 infos remain unchanged.
- Final document/whitespace/symlink checks passed; production source, scripts, pins, dependencies and storage are unchanged relative to approved main db2535a.
