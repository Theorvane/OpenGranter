# Controlled function HTTP stream responses

- A separate function HTTP response entry point uses the existing awaited bounded body handoff, cancellation and safe JSON or SSE error envelopes.
- Function fragments are delivered as response content with identity-only error metadata; failure after delivery records a content-free stream interruption without replay.
- Required usage/audit persistence precedes final usage and DONE. IAM/limit denial emits safe JSON before frames. Public request activation remains subsequent work.

Response fragments/calls are confidential response content. No key, prompt,
argument or response enters operational audit/usage/error metadata. This
internal stage does not activate public HTTP tool streams or certify #116.
