# Official schema drift contract

The pin records source URL, retrieval date, raw SHA-256 and a canonical structural projection SHA-256. Source: [official OpenRouter OpenAPI](https://openrouter.ai/openapi.json), retrieved 2026-09-29. The snapshot contains selected schema constraints, with examples/descriptions and other annotations removed.

The offline gate validates provenance shape and projection integrity. `npm run compatibility:drift` explicitly fetches only the official HTTPS URL, rejects redirects, bounds time/body size and compares selected chat request definitions. It neither changes the pin nor sends credentials or inference calls. Failures expose fixed messages, not downloaded content or transport errors.

Selected fields are model, messages, stream, max_tokens, max_completion_tokens, stop, temperature and top_p. Request reference, required field list and document versions are included. Unrelated endpoints and annotation-only changes do not affect comparison. Referenced ModelName/ChatMessages definitions are not traversed; changing those definitions without changing their reference is currently outside detection.

This is partial structural drift coverage, not JSON Schema instance validation, response/tool/streaming conformance or external-client certification. The retrieved official ChatRequest has no n property; current n=1 handling is a local/SDK extension. Nullable official fields, optional official model and other broader schema behavior remain gaps in the current local subset.
