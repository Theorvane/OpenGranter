# Native direct OpenAI text-stream response boundary

Consume an already-opened direct OpenAI SSE response with native text/refusal guards, usage:null ordinary chunks and exactly one empty-choice final usage event before DONE. Reuse bounded framing and validated sequence primitives while rejecting delegated reasoning/native-finish extensions and tools. Capture exact approved model scope; require stable response identity and preserve unknown final usage. Await delivery, interrupt on cancellation and classify HTTP/stream failures as response-started and possibly billed without reading failure bodies. Unsuffixed-to-snapshot identity mapping, other native modalities/providers and public managed streaming remain open.

This bounded internal stage preserves fixed destinations and captured scope.
It does not activate public managed streams or claim full #116 compatibility.

Native field behavior is checked against installed OpenAI SDK 7.23.0 types and the
[official streaming reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).
Ordinary usage:null is stripped before common event validation; non-null usage in a
nonempty-choice chunk rejects as outside this bounded native subset. Final null/empty usage stays unavailable; known partial counters remain known,
invalid counters remain null and no missing total is fabricated beyond the existing
shared aggregate normalization contract. Obfuscation/logprobs are
ignored and not exposed. Each chunk must report the exact configured upstream ID;
no permissive alias/snapshot matching or reasoning/tool adaptation is implied.
