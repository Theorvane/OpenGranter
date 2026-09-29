# Developer text-message contract

Both chat paths accept string-content system/developer messages only in a leading instruction prefix, followed by user/assistant text turns. Unknown keys/roles, rich content, sparse or empty arrays and mid-conversation instructions reject safely. This preserves the existing ordering subset while adding developer; it is not complete OpenRouter message compatibility.

HTTP and native adapters validate/copy/freeze the message array and each role/content pair before async credential lookup. Caller mutations cannot add/change instruction text, roles or turns later. Failure messages/events exclude content and keys. The ChatMessage type remains available from the gateway module.

OpenAI/OpenRouter preserve the original roles, order and text. Anthropic joins leading system/developer text in original order with newline separators in its system field. Gemini uses that same joined instruction text in systemInstruction and preserves user/model turns in contents. The latter two mappings do not preserve distinct system/developer priority and do not claim identical model behavior. All-instruction requests retain existing native limitations.

A developer message has no effect on IAM identity, attached roles, candidate eligibility or privileges. Authentication, model/final-provider policy, limits, required audit and usage remain shared. Prompt forwarding to Jev still requires its existing explicit sendPrompt configuration; metadata audit never gains message bodies.

Sources checked 2026-09-29: [official OpenRouter schema](https://openrouter.ai/openapi.json), [Anthropic OpenAI compatibility](https://platform.claude.com/docs/en/api/openai-sdk), [Gemini system instructions](https://ai.google.dev/gemini-api/docs/system-instructions). Model capabilities, rich/tool messages, mid-conversation instruction semantics and full client conformance remain open.
