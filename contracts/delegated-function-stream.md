# Internal delegated function stream accounting composition

- Compose internal function delivery with approved model and final-provider IAM, explicit Deny, limits, required selection audit, usage handoff and attempt audit.
- Deliver awaited function frames with frozen identity-only metadata; project the completed result to accounting-only fields without reading or retaining toolCalls.
- Return final usage and DONE only after required persistence succeeds. Missing usage stays unknown; dispatched, cancellation and output failures remain sanitized and possibly billed, without retry.
- Public HTTP function streams remain disabled; no function execution or new permission authority is introduced.

Response fragments/calls are confidential response content. No key, prompt,
argument or response enters operational audit/usage/error metadata. This
internal stage does not activate public HTTP tool streams or certify #116.
