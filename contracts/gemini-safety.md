# Gemini SAFETY Completion Contract

A direct Gemini promptFeedback.blockReason=SAFETY with omitted/empty candidates maps to one assistant choice at index 0 with content=null and finish_reason=content_filter. A singleton finishReason=SAFETY candidate with index absent or 0 maps identically when content is omitted or an exact empty model-content object: optional role=model and optional parts=[]. Malformed/null/populated content or unknown content keys fail safely.

Prompt SAFETY with any candidates is contradictory. Malformed candidate collections, multi-candidates, bad indexes and empty no-signal responses fail. Other native reasons are outside this contract.

Both prefixes and actual SDK receive HTTP 200 for valid blocks. Preserve alias and provider usage; absent/invalid usage retains existing missing/invalid accounting, never fabricated zero. Valid delivery does not invoke a configured fallback. IAM, limits and required audit precede invocation. Feedback/content/credentials stay out of metadata audit, usage and errors. Invalid normalization retains possible billing.
