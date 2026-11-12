# Canonical review process

- The explicit process accepts only createCanonicalReviewPorts from an absolute trusted bootstrap module. Legacy proxy/browser factories are not fallback.
- The factory supplies registered SSO trust, an owned SQL opener and an absolute public artifact path plus required lowercase SHA-256. Runtime verifies exact artifact bytes before opening SQL.
- Process configuration owns host/port, real clock and request IDs. Default host remains loopback; configuration is not permission to expose ingress.
- SIGTERM/SIGINT close the owned listener and SQL once; startup and shutdown failures use the existing bounded fixed diagnostics.
- Canonical catalog, usage and audit remain signed-bearer read-only APIs with mandatory durable audit, not browser sessions. Existing launchers are unchanged.
