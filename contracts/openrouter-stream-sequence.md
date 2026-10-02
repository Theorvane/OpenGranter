# OpenRouter text-stream sequence contract

The internal state validator consumes events from the OpenRouter text-chunk decoder. A successful sequence has zero or more nonterminal text deltas, one terminal text delta, one usage event, then `[DONE]`. Id and local model alias must remain stable. When a usage event repeats a finish reason it must match the terminal reason; the empty-choice usage variant may omit it. Usage is snapshotted without retaining response text.

An upstream error event, even as the first event, yields a distinct safe failed outcome with possible billing. Mismatched, duplicate, out-of-order, post-completion and truncated streams raise one fixed error with possible billing and permanently invalidate the sequence. They never become successful completions. Missing or invalid counters in a valid usage frame remain explicit for later accounting; the state validator does not invent counts.

This component does not control the upstream connection or client response, write audit/usage records, or authorize routes. Client `stream:true` remains rejected until those gates are integrated.

Delegated text streaming preserves bounded optional system_fingerprint metadata per the [stream fingerprint contract](stream-fingerprints.md). The final usage fingerprint comes from its own upstream event, with no carry-forward or authority semantics. Null is a local OpenAI compatibility allowance; the official streamed schema selects string only. Malformed values fail safely and fingerprints stay outside audit/ledger metadata.
