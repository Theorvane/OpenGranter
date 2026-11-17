# Canonical read-only SSO review boundary

The trusted caller supplies the same committed/autocommit SQL client, registered-key SSO configuration, clock and request-ID factory used by the canonical handlers. No caller writer override is accepted. Caller owns migrations, connection lifecycle, listener bind, TLS and artifact provenance.

- /management/v1/models and its detail namespace delegate unchanged to the canonical catalog handler.
- Exact /management/v1/usage and /management/v1/audit delegate unchanged for every method, preserving method, query, bearer, scope and audit semantics. CSV shares the canonical endpoint.
- Everything else returns private 404; no token write, inference route, fallback or SPA rewrite.
- The optional trusted public JavaScript string enables only the existing public shell. Explicit invalid values fail construction. A public shell grants no API authority.
- The server factory returns an unbound server. No runtime/default/service/bootstrap changes.

Acceptance: actual loopback HTTP with signed JWT and PGlite proves list/detail, scoped usage/audit JSON and CSV, foreign principal denial, no cookie trust, fresh revocation, mandatory audit failure/acknowledgement, unchanged unknown-route behavior and no client callback override. Local evidence is not native browser, IdP, installed PostgreSQL or deployment evidence.
