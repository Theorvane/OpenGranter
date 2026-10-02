# Delegated HTTP text streaming

Both chat bases accept stream:true only with a configured trusted streaming port. The supported subset is delegated text history and existing sampling/text/json_object controls. Tool declarations, choice controls, tool-call/result history, unknown stream options and managed/direct streams are rejected as invalid_request before inference; stream:false/omission retains ordinary chat behavior.

The HTTP adapter uses the existing delegated text coordinator. Model/final-provider IAM, verified provider slug bounds, limits and selection audit precede every upstream call. It returns ordinary path-specific JSON error statuses until a validated first delta. Thereafter it sends text/event-stream with no-store, a request ID and JSON-escaped data frames. Failure is one data frame containing the existing fixed error envelope, then EOF without DONE. No provider error body or callback cause is exposed.

The zero-high-water-mark body retains one pending frame and awaits each pull before further frame callbacks. Request abort and response-body cancellation reject pending writes and signal the upstream; listeners are removed on completion. Upstream work is never replayed. Final complete usage and DONE follow successful attempt usage and outcome audit; missing usage stays unknown and is not fabricated.

A separate stream-interrupted audit records authenticated attribution, request ID, route version, model alias, failed/cancelled outcome and upstreamCompleted. It contains no text, secret or abort reason. A final delivery loss after successful upstream accounting does not overwrite or duplicate that attempt; body consumption does not certify physical socket acknowledgment. Required interruption audit failure suppresses terminal success and yields audit_unavailable where a connected client can receive an error. Closed clients cannot receive it; durable recovery of failed audit writes remains operational work.

Direct-provider/tool/multimodal streams, additional stream option fields, provider-specific complete conformance and named external applications remain release gaps. This bounded delegated feature is not complete OpenRouter compatibility.

Delegated text streaming preserves bounded optional system_fingerprint metadata per the [stream fingerprint contract](stream-fingerprints.md). The final usage fingerprint comes from its own upstream event, with no carry-forward or authority semantics. Null is a local OpenAI compatibility allowance; the official streamed schema selects string only. Malformed values fail safely and fingerprints stay outside audit/ledger metadata.

Started /api/v1 failures add validated delivered chunk identity and one content-free finish_reason:error choice under the [midstream error contract](midstream-error-chunks.md); legacy symbolic errors and pre-frame JSON remain unchanged. This does not expose raw upstream error messages or widen metadata accounting.


Delegated streaming supports optional string/null refusal deltas separately under the [stream refusal contract](stream-refusals.md). Valid refusal streams are successful deliveries with shared required accounting/audit and no fallback; malformed values fail safely. No transcript enters operational metadata.
