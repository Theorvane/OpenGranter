# Managed Gemini function signature streams

## Issue and problem

Issue: #412, continuing #116. Nonstream Gemini functions preserve same-part thought signatures, but native function streams reject them and signed history fails before credentials. Installed OpenAI 7.23.0 preserves raw stream extensions; OpenRouter 1.4.18 strips them.

## Scope and expected behavior

Preserve complete native function-call Part.thoughtSignature as tool_calls[].extra_content.google.thought_signature on both bases, including parallel/sequential calls and missing IDs. Replay signed history only on native Google function mode. Keep all IAM, limits, fixed hosts, registered scope, output caps, reported usage, required audit/persistence and privacy controls. Signatures are private response content, never ledger/audit metadata or authority.

Exclude signed text/thoughts, partial function objects, standalone late signatures, model eligibility changes, reasoning-detail bridges and SDK patches. Function requests retain existing thinkingBudget:0 and effort conflict. Models unable to disable thinking may fail natively. Full #116 and unresolved #7 remain open.

## Design

Reuse the exact bounded frozen Google metadata snapshot. Allow it in trusted client projection and native Google normalization only; inbound OpenAI/delegated fragment decoding stays closed. Shared private function assembly snapshots metadata, rejects conflicting signatures and includes signature string units in its existing one-MiB aggregate budget with IDs/names/arguments. Discard private assembly on transport, callback, framing or sequence failure. Preserve same-part call association without inferring late association.

Official facts: [Google signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures) and [Part](https://ai.google.dev/api/generate-content#Part) establish same-part association. Standalone function-signature timing is unverified; text-only signature chunks and Vertex partial-argument examples do not establish it. Repository grilling fact delegation verified raw OpenAI stream preservation and OpenRouter stripping. This extends an existing reversible protocol subset; no new domain term or costly ADR is needed.

Update PRD, architecture, acceptance, compatibility and [the contract](../../contracts/gemini-signature-streams.md). Supersede only the prior nonstream contract's stream exclusion.

## TDD plan

First add native stream and public shared sequence/projection tests for exact immutable signed calls, signed captured history and aggregate budget. Expected red: native response/history rejection and metadata discarded by private assembly/projection. Add malformed signatures, signed text/late chunks, conflicts, clean EOF, callback/abort, strict unrelated decoder cases and actual SDK sockets on both bases. Verify raw HTTP and persisted direct/dual success, fresh Deny, required usage/audit failures and privacy. Measure OpenRouter stripping and safe failed continuation explicitly.

Smallest implementation changes the opt-in snapshot, sequence retention, native projection and Google function-history guard. Run focused suites, npm run format and full npm run check; record red/green evidence.

## Delivery

Issue and branch precede code. Link plan/contract and report exact test evidence and SDK/model limitations in the PR. Require exact-head sjungwon03-ai review and both CI checks, then sjungwon03 squash merge and clean synchronized main. Fixture coverage is not live-provider certification. Rollback removes only this bounded stream extension.

## Verification evidence

Native Gemini function streams previously rejected thought signatures needed for signed continuation. Complete native function parts now preserve the exact documented tool_calls[].extra_content.google.thought_signature extension in client deltas and completed calls, and signed history replays on the original function part. Parallel/sequential association and reserved missing-ID correlation remain exact.

Shared private assembly snapshots and freezes the metadata, rejects conflicting/malformed signatures, charges signature units together with IDs/names/arguments against the existing one-MiB budget, and discards private state on failure. Trusted outbound projection opts in; delegated and direct OpenAI stream decoders and unsupported adapter histories stay closed. IAM/Deny, limits, fixed registered host/model scope, administrator caps, immutable pre-secret history, clean terminal/EOF, cancellation, required usage/audit, reported-only totals and metadata privacy remain enforced.

TDD: before production changes, the new native/SDK/stored signature probes reported 18 expected failures and 40 passing denial/malformed boundaries. Failures reproduced native response/history rejection and dropped/unvalidated private assembly metadata. Final focused verification passes 220 tests. Added 53 cases cover native same-part signatures, parallel/separate calls, missing IDs, sequential immutable replay, exact shared budget, conflicts/discard, malformed metadata, signed-text/late-chunk rejection, unrelated decoder denial, callback/abort, raw HTTP and actual SDK sockets on both bases, and persisted direct/dual routes. Raw signed requests verify auth/model/provider Deny, limits, required audit/usage failures, reported/missing usage and privacy.

Installed OpenAI 7.23.0 raw streams preserve signatures and support result continuation; generated SDK types omit the extension. Installed OpenRouter 1.4.18 strips it: socket probes observe loss and safe failed continuation when a required signature is absent. This does not certify signed Gemini OpenRouter SDK compatibility or live providers. Signed text/thoughts, partial native arguments, standalone late signatures, models requiring thinking and broader clients remain open. Existing thinkingBudget:0 and effort conflict remain; no reasoning-detail/tool bridge or new model eligibility rule is invented. Full #116 and unresolved #7 remain open, with pin v19 unchanged.


Full npm run check passes strict types, lint, 2469 tests with one existing PostgreSQL skip, planning/contracts/fixture checks and offline schema integrity.
