# Isolated OpenCode text conformance

Register a custom @ai-sdk/openai-compatible provider with an explicit proxy-token environment reference and chosen model. Verify installed OpenCode 1.18.5 with an opt-in local socket runner over both bases, fresh temporary config/data/cache/work directories, bounded lifetime and cleanup. Do not write real user configuration or call a real upstream. Named-client model registration is explicit and does not claim automatic GET models discovery. This first test subject is reversible; broader clients and #116 remain open.

Response fragments/calls are confidential response content. No key, prompt,
argument or response enters operational audit/usage/error metadata. This
stage does not certify complete #116 compatibility.

The exact-version runner fails explicitly when the client is absent or mismatched; it
is separate from default CI. It verifies actual model listing/selection and complete
text streams, not automatic gateway discovery. See [reproduction guide](../docs/opencode-conformance.md).
