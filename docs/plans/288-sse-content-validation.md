# Validate SSE text and refusal before projection

## Issue and problem

- Issue: [#288](https://github.com/Theorvane/OpenGranter/issues/288); release gate [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- The exported client SSE encoder can silently discard injected content/refusal on usage events and repeatedly reads those fields on deltas. A changing accessor can project a value other than the validated capture.
- The existing decoder/refusal contracts already require content-free usage frames and validated optional string/null response fields.

## Scope and expected behavior

- Capture optional content/refusal once at the encoder boundary. Validate and serialize only those captures, preserving omission, null, empty strings, Unicode and embedded newlines.
- Reject malformed/substantive content/refusal on usage-only events before incomplete-count suppression. Absent/null/empty fields remain acceptable and are not replayed in final frames.
- Keep scalar/detail reasoning guards, metadata, final usage, DONE and fixed non-leaking errors unchanged. No request controls or new supported modalities.
- Permissions, secrets, usage and audit effects: no changes. Existing gateway authentication/IAM/Deny/limits and persistence gates remain mandatory; no operational content retention.

## Design

- Extend the independent encoder's existing once-captured reasoning validation to content/refusal. Use the existing validated event shapes; untrusted injected fields remain subject to runtime checks despite TypeScript types.
- Reusing the decoder alone would leave direct callers unprotected. Keep the encoder independently enforcing its documented output boundary.
- No unresolved product decision is settled. No domain term or architectural trade-off requires a glossary/ADR change. Broader instance validation and external-client certification remain open.
- Update [encoder contract](../../contracts/openrouter-client-sse.md), [refusal contract](../../contracts/stream-refusals.md), PRD, architecture, acceptance and compatibility inventory.

## TDD plan

- First exported-encoder tests: usage-only substantive/malformed fields must throw the fixed error with complete, absent, partial and invalid counters. Expected red: missing expected exception.
- Delta changing accessors must be read once and output only their validated string capture; expected red: repeated reads or unvalidated projected value.
- Cover harmless omission/null/empty usage fields, exact delta escaping/null/empty/omission and malformed delta values. Preserve reasoning/detail/metadata and HTTP/SDK success/denial/failure regressions.
- Implement the smallest local capture/validation change, run focused encoder/stream suites, then npm run check and git diff --check.

## Delivery

- Create issue and plan, update contract/acceptance cases, record failing regression results, implement and record green evidence, commit with authorized identity/trailers, open PR, review using sjungwon03-ai and merge as sjungwon03 after required CI.
- Risk: rejecting harmless null/empty metadata or weakening incomplete-usage omission. Explicit positive tests guard both. Rollback is reverting this bounded encoder change; no migration or stored-data change.
- Record red/green commands, full-check counts and remaining compatibility gates in the PR.

### Verification evidence

- Red: `node --experimental-strip-types --test test/openrouter-client-sse.test.ts` produced six passes and two expected failures: missing rejection of substantive usage content and serialization of an unvalidated object from a changing content getter.
- Green: the encoder and chunk-decoder suites passed all twenty-seven cases after the local capture/validation change. The looped cases cover both fields, complete/missing/partial/invalid counts and exact output semantics.
- `npm run format` applied no changes; existing informational/warning diagnostics were not expanded. `npm run check` passed 1,336 tests with one existing optional PostgreSQL skip, strict types/lint, planning/link/contract/fixture checks and pinned schema integrity.
- Runtime HTTP/SDK authentication, denial, cancellation and persistence-failure suites remain green. No source pin change or complete compatibility claim; #116 stays open.
