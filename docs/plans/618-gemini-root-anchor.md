# Bounded Gemini root anchor metadata

Issue #618, refs #116 and [plan552](552-ai-sdk-structured-output.md).

## Scope and design

Extend existing definition anchors to optional root-only $anchor metadata for explicit strict:false responseJsonSchema transport. Use the existing ASCII initial letter/underscore, subsequent letters/digits/underscore/dot/hyphen and 1..64 character bound. Reject duplicate root/definition names. Root-target references remain invalid (recursive roots); only existing root-$defs targets resolve. Nested non-definition anchors remain invalid. Preserve immutable captured schemas, canonical mixed-cycle detection, unused definitions, depth16/shared20,000 visits/128 definitions, IAM/limits/accounting/persistence/privacy. Typed, nullable, union and reference roots may carry metadata with optional existing $id. No fetching, routing, output validation, equivalence, live certification, strict/tool/Anthropic widening, dependencies/pins/storage or #561 changes. Full #116 and unresolved #7 remain open.

## TDD and delivery

Issue and plan precede tests/source. Extend existing both-base immutable HTTP, actual OpenAI SDK, native captured stream and IAM/limits/persistence fixtures with direct/chained anchored roots. Add valid root shapes, exact64/65 names, malformed/duplicate/nested/root-recursive references, invalid unused definitions and existing resource-bound parity. Record red before minimal validator correction. Run focused tests and standard taskset-c0,1 npm run check; retain failures, no replacement-pass claims or weakened gates. Require exact-head formal APPROVED plus all CI success before normal merge. Local Docker/bridge/systemd/live-provider certification remains unverified.

## Verification evidence

- Meaningful red before source edit: 292 passed, 9 failed, including eight new immutable HTTP/actual SDK/native stream/IAM-limit-persistence cases and the root-anchor validator probe. Minimal root-anchor validator produced 296 passes and five obsolete root-anchor rejection fixtures failing. Removed only newly supported root-anchor exclusions (two keyword-list entries and three schema entries); nested, recursive, duplicate and unsafe rejection remains.
- Final focused four-file selection: 414 passed, zero failures. Added exact64/65 grammar, typed/nullable/null/union/reference roots with optional identity, immutable capture, malformed/duplicate/nested/root-recursive references, unused invalid definitions and resource-bound parity. Invalid root fixtures reject before secrets on both HTTP bases and native nonstream/stream paths. Strict/tool/Anthropic controls remain covered. Typecheck passed.

- Standard taskset-c0,1 npm run check FAILED: 8,471 passed, six file-level SIGKILL failures, one optional external PostgreSQL skip (~248 seconds). Failed files: model-benchmark-metadata, model-discovery-metadata, postgres-dual-http-server, postgres-gateway-runtime, postgres-google-signature-streams, postgres-token-management. No reported assertion failures; NOT a local full pass. Cgroup cumulative oom_kill353 (previous run346) is consistent with memory pressure, not individual-process causation proof. No retry, concurrency/deadline/assertion weakening or replacement-pass claim. Types/lint passed with existing diagnostics. Source/tests unchanged after full gate; only documentation evidence appended.
- Separate planning/link/contracts/fixture-secret scan, all six offline pinned-schema integrity checks and whitespace checks passed. Logs: /tmp/opengranter-618-{red,green,format,typecheck,focused,full,docs,pins}.log. Local Docker/bridge/systemd/live-provider certification remains unverified.
