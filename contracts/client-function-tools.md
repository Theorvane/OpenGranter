# Function Tool Request Controls Contract

Both `/v1/chat/completions` and `/api/v1/chat/completions` accept the same non-streaming function-tool request subset. `tools` is an array (including empty) of exact `{type:"function",function:{name,...}}` objects. A name is a nonempty string of at most 64 UTF-16 code units. Optional description is a string, parameters a plain JSON object, and strict a boolean or null. Nested parameter values must be finite JSON values, with bounded depth and node count. Native invokers copy and freeze the schema before awaiting a secret.

`tool_choice` may be `none`, `auto`, `required`, or an exact named function choice `{type:"function",function:{name}}`. `parallel_tool_calls` may be omitted, null, true or false; null uses the omission path. Direct OpenAI and delegated OpenRouter forward supplied supported controls. Direct Anthropic and Gemini reject any supplied non-null control, including an empty tools array or `false`, before credential lookup. Unsupported OpenRouter server tools and malformed controls reject at the HTTP boundary before route selection. Native malformed controls reject before credentials.

These request fields do not select the model, route, final provider, credential, principal or audit identity. Existing IAM, limit, audit and usage gates apply. Tool names, descriptions and schemas stay out of metadata audit, operational logs and errors. A post-transport failure retains possible-billing accounting. Validated non-streaming function-call responses are supported by the separate response contract; text-only tool-result history is supported by the separate history contract. Streaming, native Anthropic/Gemini mapping and source-drift pin coverage remain open under #116.

Source: https://openrouter.ai/openapi.json, raw snapshot retrieved 2026-09-29.

Fixed tool positions/length and declaration/choice fields are captured once under
the [capture contract](function-tool-capture.md). Shared nested schema arrays use
one length while retaining descriptor-only accessor rejection and deep freezing.
