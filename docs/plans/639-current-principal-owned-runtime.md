# Owned management Account API integration (#639)

1. Reuse the reviewed-design Account boundary from PR935; do not define login, cookies, CSRF, scopes, migrations or a new session contract.
2. Reproduce the existing owned management listener returning 404 for exact /management/v1/me and /principal over real loopback HTTP with a signed test bearer and migrated embedded PostgreSQL.
3. Route only these two exact paths through the canonical current-principal composition using the same owned connection and enumerated JWT/audit inputs. Keep token writes, catalog, usage, audit, read-only review and default process selection unchanged.
4. Verify exact identity projection, current binding revocation, denied model authority, mandatory audit completion, missing audit schema failure without installation, safe malformed acknowledgements and unknown-route/method/query containment through the owned listener. Run existing management runtime and browser bootstrap regressions, full typecheck and changed-file lint.
5. Submit a dependent PR against PR935, request independent exact-head review, and await required CI. Do not merge without formal approval. Separate local test identity/embedded database from real IdP/browser/installed PostgreSQL/provider acceptance.

## Main integration (2026-11-18)
6. Integrate reviewed main e6aecea (Account API + operations/CSP/disconnect composition) into this existing runtime branch; retain exact-path dispatch on the owned connection without adding another listener or schema installation.
7. Verify the public stylesheet and shell remain SQL-free and anonymous on the owned listener, followed by denied anonymous Account access and fresh authenticated identity. Require new exact-head CI and independent formal review; native-browser/IdP/installed PostgreSQL acceptance remains separate.
