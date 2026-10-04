# Managed Gemini function signature streams

Issue: #412. Plan: [412-gemini-signature-streams](../docs/plans/412-gemini-signature-streams.md).

Complete streamGenerateContent function parts may carry sibling thoughtSignature. Preserve that opaque original string on the corresponding client delta and completed call as extra_content.google.thought_signature. Replay complete correlated signed history on native Google function streams using the original Part association, native IDs or existing missing-ID convention. Parallel and sequential calls retain separate association. No signature decoding, verification, fabrication, execution or authorization inference.

Use the existing exact nonempty bounded frozen Google metadata shape. Charge signatures against the shared one-MiB retained string-unit budget together with call IDs, names and arguments. Reject conflicts and discard private state on failure. Validate each native event before delivery; completion still requires supported terminal, clean framed EOF, required usage/audit persistence and reported-only counters. No private call/signature content enters operational errors, ledger or audit metadata.

Trusted outbound projection admits this extension; incoming delegated/OpenAI streams and unsupported adapter history remain closed. Signed text, visible thoughts, partial native function objects and standalone late signatures remain unsupported because their native association is not established. Do not invent encrypted reasoning-detail/tool association or change thinking defaults/model eligibility. Existing thinkingBudget:0 and effort conflict remain.

Raw HTTP and installed OpenAI 7.23.0 raw stream iteration must retain the extension on both bases. Installed OpenRouter 1.4.18 strips it; socket tests measure the loss and safe continuation failure when a required signature is absent. This does not establish complete OpenRouter SDK compatibility or live-provider certification. Preserve existing registration, host/model scope, IAM/Deny, limits, usage/audit failure and privacy controls in stored direct/dual routes. Full #116 and unresolved #7 remain open, with pin v19 unchanged.

Sources: [Google signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures), [native Part](https://ai.google.dev/api/generate-content#Part). Function-signature-only timing remains unverified; text signature-only guidance does not establish function association.
