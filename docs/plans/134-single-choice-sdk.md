# Single-choice SDK requests

## Issue and problem

- Issue: [#134](https://github.com/Theorvane/OpenGranter/issues/134), compatibility parent #116.
- Clients explicitly send n=1 while the decoder rejects n. The response contract already supports exactly one choice; no actual SDK socket tests currently verify discovery/chat registration.

## Scope and expected behavior

- Accept omission or numeric n=1 on both chat paths and four adapters. Null, other counts, nonnumeric and non-finite values reject before route/credential/transport work.
- OpenRouter/OpenAI map supplied n=1; Gemini maps generationConfig.candidateCount=1; Anthropic uses its existing single-message response and sends no native n field.
- Capture before secret lookup and preserve sampling, stop/output settings, administrator caps, IAM, limits, audit and usage.
- Add exact development-only OpenAI SDK 7.23.0 with a locked dependency; real SDK discovery/chat/error tests run against a loopback Node server with fake upstreams, no real credentials.
- Out of scope: n>1, full response validation, official spec drift, streaming, tools, and named external application workflows. SDK smoke tests do not close the full compatibility gate.

## Design

- Shared pure single-choice validation at HTTP and adapter boundaries; project/capture the known literal and map only supported native fields.
- Preserve the current one-choice return contract rather than accepting n>1 and silently dropping choices. Native response multiplicity verification remains separate conformance work.
- Test SDK with explicit local baseURL/proxy token and maxRetries=0 to avoid hidden request duplication. Each server is closed deterministically; transports return synthetic native replies.
- Update [contract](../../contracts/client-single-choice.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [compatibility](../openrouter-compatibility.md).

## TDD plan

- Four adapters: n=1/omission, invalid values before secrets, mutation during secret lookup and combination with existing native settings.
- Public HTTP/SDK: discovery, real successful single-choice requests across managed/delegated paths, malformed n and IAM/authentication/limit/audit/upstream failures with safe SDK errors and usage effects.
- Demonstrate red for missing n, implement minimal validation/mapping, then strict type checks, focused warning-free Biome and npm run check.

## Delivery

- No migration/live provider calls. Rollback removes literal acceptance and SDK smoke tests, leaving existing implicit single-choice requests unchanged.
- Record TDD/full check evidence, pinned SDK version and remaining full-client gaps in the PR.

## Verification evidence

- Red: 15 failures and two passes in the new 17-case adapter/actual-SDK suite against the previous implementation.
- Green: all 17 cases pass, including standalone n mapping, captured values, SDK discovery/chat across four adapters and both base URLs, and safe denial/failure workflows.
- npm run check passed: strict TypeScript, lint, 628 passing tests, one optional external PostgreSQL test skipped, and planning/link/contract/fixture checks.
- Focused warning-free Biome and diff checks passed; CLAUDE.md remains an AGENTS.md symlink. OpenAI SDK 7.23.0 is exactly pinned in the lockfile as development-only.
- No live upstream, OpenAI host, or real key was used. Full response conformance, streaming/tools and named external application workflows remain open.

## Main integration

- Preserve both single-choice/SDK and typed-error documentation when merging main after PR #133. The conflict affected only appended document sections; neither requirement was discarded.
- Validate the combined implementation with the full repository gate before publishing the refreshed head. CI and reviewer approval must apply to that head before merge.
- Integrated `npm run check` passed: strict TypeScript, lint, 629 passing tests, one optional external PostgreSQL test skipped, and planning/link/contract/fixture checks.
