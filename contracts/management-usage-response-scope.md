# Scoped usage JSON response integrity (#637/#642)

The management usage JSON client accepts a ready page only when every projected record matches all explicitly submitted `principal_id`, `model`, `request_id`, `from_ms` and `to_ms` filters. Matching is exact, without normalization; time intervals remain `[from_ms, to_ms)`. Scalars are captured before awaiting the transport, so caller edits cannot widen or narrow the in-flight response check.

Any mismatch invalidates the entire page as the existing generic `unavailable` result. Do not silently discard rows, expose a partial success, return raw errors, follow cursors automatically or publish hidden row data. Empty scoped pages remain valid. Omitted principal scope does not let the browser infer a current principal; fresh authentication, authorization, durable audit and SQL isolation remain mandatory on the server.

CSV continues to rely on the existing server exact-scope checks and client media/pagination/byte validation; this change does not parse, reconstruct or claim to independently verify CSV row scope. No endpoint, schema, alias bound, session, activation or provider call changes.

Regression transports returning inconsistent rows are adversarial contract tests, not evidence that the installed server currently leaks them. Signed-SSO loopback/PGlite tests and source/built-browser-artifact tests are local evidence, not native rendering or installed PostgreSQL acceptance.
