# Explicit SSO catalog client integration

The separately named createSsoManagementCatalogClient and createSsoManagementCatalogSession factories use only GET /management/v1/models and its encoded-alias detail path. Their caller supplies an already authorized request port. They never create/store credentials, authenticate a browser, select an arbitrary URL, fall back to proxy endpoints, activate a session, or grant permissions. The lifecycle is a UI state machine, not an HTTP session.

The existing proxy factories retain /api/v1/models, reserved count/user rejection and published optional display metadata. SSO permits count/user aliases and validates navigable aliases, safe nonnegative integer creation timestamps and OpenGranter ownership. It projects only the existing basic SSO model fields; proxy display metadata is not implicitly added to the SSO publication contract. Shared bounded bytes, fatal UTF-8, cancellation/identity epochs and status-only errors remain enforced.

Tests distinguish restored unit/lifecycle coverage from a real loopback Node HTTP boundary with signed test JWT, migrated PGlite, fresh IAM and durable mandatory audit. Those results do not certify a company IdP, browser login, installed PostgreSQL, live provider or deployment. Existing follow-up stacks are preserved and require their own review/rebase; this integration does not approve them.
