# Disconnected management response transport

- Scope: the shared Node adapter, including management list/detail/token responses, when the client disconnects before the Fetch handler returns.
- The application request signal is aborted. An eventual response is not delivered; its unused body receives one best-effort cancellation attempt.
- The request listener settles without waiting for producer cancellation, whether cleanup completes, rejects, throws or never settles. A locked/consumed body may refuse cleanup; no forced reclamation is promised.
- Listener cleanup happens even when producer cancellation stalls. A separate client can still receive an ordinary application response; this transport contract supplies no authentication itself.
- Existing live streaming/fallback behavior remains unchanged. Disconnect is not mutation rollback, token revocation, inference retry, total request deadline, session acquisition or a new authorization grant.
- Tests use real bound loopback sockets. They do not establish browser login, external IdP, installed PostgreSQL, TLS or provider acceptance.
