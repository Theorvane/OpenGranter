# Optional Text Message Name Contract

Both chat prefixes accept optional string name on supported system/developer/user/assistant text messages, including exact text-part arrays normalized by the existing HTTP boundary. Strings remain exact, including empty values, spaces and Unicode; null/non-string values and unknown message keys reject before routing. Existing instruction ordering and native string-content scope are preserved.

The shared immutable snapshot captures role/content/name before awaits. OpenAI/OpenRouter forward names as native message fields. Direct Anthropic/Gemini reject any supplied name before credentials/transport, including empty strings, without a fabricated provider usage record. No prompt rewriting, name dropping or capability-based rerouting is introduced.

Names are untrusted prompt protocol data, never authenticated principal identifiers. IAM, limits, usage/audit attribution and proxy-token authority remain based on the authenticated principal. Do not record names in metadata audit/errors or operational logs. Safe transport failure accounting remains unchanged.

Provider-specific named-speaker mappings, mid-conversation instructions, tool/multimodal messages, streaming and complete external-client conformance remain open. The reviewed source-drift projection does not traverse message definitions; name-specific referenced-schema drift remains outside that gate.
