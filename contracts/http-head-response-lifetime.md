# HTTP HEAD response lifetime

The shared Node HTTP adapter sends the same validated status and representation headers supplied by its application for HEAD, with no response body. It does not read the response producer, including an application-provided error fallback. It cancels the unused producer once on a best-effort basis, without waiting for throwing, rejecting or never-settling cleanup. Application authorization and routing still execute; HEAD does not become an implicit GET or bypass authentication.

Invalid response metadata still triggers the existing safe fallback with failed headers removed. Management no-store/nosniff headers remain enforced. GET streaming and fallback body/error behavior are unchanged. This is not an installed proxy/TLS/browser-login certification or a deployment change.

Evidence: actual loopback HEAD/GET requests cover normal and fallback producers with four cleanup behaviors, no body pull, preserved representation headers, safe invalid fallback and a subsequent functioning GET. Existing streaming/disposal/header containment and canonical operations HTTP tests run alongside it.

When a non-HEAD request disconnects while an application fallback body is being buffered, the adapter cancels its active reader and settles the request listener without waiting for producer cleanup. UTF-8 decoding (including split multibyte characters and BOM removal) and safe fallback containment remain unchanged. Actual loopback tests cover complete, throwing, rejecting and stalled cancellation.
