# Streaming SSE framing contract

The parser accepts a byte stream and yields only complete SSE `data` event payloads. It ignores an initial UTF-8 BOM, comment lines and fields other than `data`. LF, CR and CRLF delimit lines; adjacent `data` lines join with one LF. A blank line dispatches an event, including an empty `data` value. EOF without a final blank line discards pending data.

The parser does not interpret JSON, `[DONE]`, finish reasons, usage or midstream errors. A later protocol layer must validate those before emitting a client stream. `stream:true` remains unsupported at the gateway in this issue.

Input decoding is strict UTF-8. Lines and collected event data have a default one MiB bound. Invalid bytes, excessive data and transport failures raise one fixed error with no upstream text. The reader is consumed on demand; stopping iteration early cancels it. A complete source releases the lock without cancellation.

Sources: [HTML SSE parsing rules](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation) and [OpenRouter streaming behavior](https://openrouter.ai/docs/api_reference/streaming).
