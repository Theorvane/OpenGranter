# Text-part input contract

Both chat paths accept system/developer/user/assistant content as a string or nonempty dense array of exact objects with type=text and string text. Parts concatenate in order without inserted separators; whitespace, Unicode and empty segments remain literal. Internal ChatMessage and all native payloads remain string-content messages. This expands external HTTP decoding, not the typed raw-native adapter input contract.

Any unsupported/mixed image/audio/file/tool part, unknown part key, malformed/empty/sparse array or unsupported role rejects the whole request before routing/credentials/transport. No part is silently discarded. Existing role/order checks, body-size boundary and token/sampling validation remain effective.

String inputs retain prior behavior. All four providers receive the same normalized text through their established mapping. Authentication, model/final-provider IAM, limits, required audit and usage remain shared. Failures/events do not expose contents or keys, and this change does not enable content auditing.

Concatenation does not preserve native text-block or cache boundaries. Multimodal/refusal parts, cache_control/name fields, tools, streaming and complete external-client conformance remain open under #116. Source checked 2026-09-29: [OpenRouter API overview](https://openrouter.ai/docs/api_reference/overview) and [official schema](https://openrouter.ai/openapi.json).

Instruction arrays still belong only to the leading system/developer prefix. Assistant-history arrays use the existing assistant mapping. Shared message validation rejects unknown message keys and roles after normalization. See [extension plan](../docs/plans/148-message-text-parts.md).
