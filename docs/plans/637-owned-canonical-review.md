# Owned canonical review listener (#637)

1. Reuse the reviewed canonical review composition on main, including signed SSO, fresh IAM and durable audit. Do not change token listener, browser authority, cookies, CSRF, CORS or default activation.
2. Add an explicitly invoked runtime owning migrations, one SQL connection, bind and close. Accept only canonical configuration and an optional trusted public bundle, never caller audit overrides.
3. Demonstrate RED then migrated loopback catalog/detail and usage/audit JSON/CSV, fresh revocation, failure cleanup and idempotent shutdown. PGlite is not installed PostgreSQL or IdP.
4. Require exact-head CI and independent formal approval. Browser login, provider use and deployment remain separate gates.
