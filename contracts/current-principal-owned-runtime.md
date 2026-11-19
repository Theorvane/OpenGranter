# Owned management Account API (#639)

The explicitly invoked startPostgresSsoManagementGateway listener also serves the existing GET /management/v1/me and /management/v1/principal contracts with the same caller-owned migrated connection. Public browser shell access never grants identity. All Account authentication and mandatory audit rules from canonical-current-principal.md apply unchanged. Only exact routes are added; no cookie/session acquisition or default process activation changes.

The optional current-principal audit contract remains outside migrations. The runtime must not install it: absence or malformed acknowledgement yields 503 without identity. Operators still need explicit schema approval and installation before live Account acceptance. Existing proxy-token, catalog, usage and audit endpoints and resource ownership stay unchanged. Extra caller authentication/audit callbacks are not forwarded to the Account composition.

Acceptance: actual loopback HTTP + signed test JWT + migrated embedded PostgreSQL verifies both projections, fresh revocation, no implicit model rights, audit-before-disclosure, missing-schema suppression, anonymous invalid bearer, malformed acknowledgement and exact routing. Existing owned-management socket and artifact/bootstrap tests must remain green. This is not IdP login, browser-session, installed database or deployment evidence.
