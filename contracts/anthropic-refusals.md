# Native Anthropic Refusal Contract

Direct Anthropic stop_reason=refusal with content as a valid empty or text-only array maps to one assistant choice with content=null, refusal=null and finish_reason=content_filter. Text content is incomplete and discarded; stop_details is not propagated. String text blocks may contain empty text. Missing/null/malformed/mixed/tool/thinking content remains invalid. Empty content without explicit refusal remains invalid.

Normal end_turn, stop_sequence and max_tokens text mappings remain unchanged. Both prefixes and actual SDK receive the filter envelope, published alias and projected provider usage. Missing/invalid usage retains existing status; tokens do not establish billed money and refusal does not fabricate a billing waiver.

A delivered refusal is a successful attempt and does not invoke a configured fallback. Authentication, destination IAM, limits and required audit precede invocation. No text, stop_details or credentials enters metadata audit, usage or errors. Invalid responses retain safe possible billing after upstream response. Streaming, richer native blocks and automatic refusal fallback remain outside this contract.
