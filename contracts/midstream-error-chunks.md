# Compatible midstream error chunks

After a validated delegated text frame is handed to the response body, /api/v1 midstream failures emit one JSON SSE payload with the delivered id/created/local model alias, object:chat.completion.chunk, the existing fixed safe numeric error/request_id and choices:[{index:0,delta:{content:""},finish_reason:"error"}]. No provider, fingerprint, refusal, text or token counters enter the error chunk. EOF follows; no DONE or fabricated usage is emitted.

The coordinator passes an explicit frozen identity-only snapshot after validation; the HTTP adapter retains it only after an awaited body handoff. Invalid later deltas cannot overwrite earlier delivered metadata. Body handoff does not certify socket acknowledgment. Before any validated frame, the existing safe JSON/status remains; legacy /v1 retains its standalone symbolic error envelope.

IAM/limits, required attempt usage/outcome audit, cancellation/backpressure and separate interruption audit remain unchanged. If required interruption audit fails, the compatible chunk still reports the existing audit_unavailable error with fixed metadata. Upstream messages/codes, precise retry classifications, direct/tool/multimodal streams and full response/client conformance remain gaps.
