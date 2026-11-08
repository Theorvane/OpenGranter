# Explicit SSO operator bootstrap

Select `scripts/sso-browser-bootstrap.ts` as the absolute `OPENGRANTER_BOOTSTRAP_MODULE` for `scripts/start-sso-browser.ts` only when explicitly approved. Existing `npm start` remains the proxy process and does not enable SSO/browser routes.

Required configuration:

- `OPENGRANTER_SSO_ISSUER`: the reviewed HTTPS issuer, exact matching as in the existing RFC9068 verifier.
- `OPENGRANTER_SSO_AUDIENCE`: the management API audience, not an ID-token audience.
- `OPENGRANTER_SSO_JWKS_PATH`: absolute local public JWKS file, regular nonsymlink, 1–65536 bytes, valid UTF-8 JSON accepted by the existing RS256 public-key validator. No discovery/network loading or private keys.
- `OPENGRANTER_BROWSER_ARTIFACT_PATH`: absolute trusted public build artifact; existing runtime artifact validation still applies.

Standard `pg` process configuration (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, TLS settings as supported by the installed driver) belongs to the operator. This module passes no TLS override and never logs configuration. Inject credentials through the approved runtime secret mechanism, not command-line literals or a committed environment file. It neither provisions accounts nor changes database roles. PostgreSQL opens lazily after trust loading; migrations, HTTP and shutdown stay in the existing owned runtime. Startup trust errors have fixed diagnostics with no path, key, credential, file contents or cause.

Example after approved local configuration is injected and the public artifact is built:

```sh
OPENGRANTER_BOOTSTRAP_MODULE="$(pwd)/scripts/sso-browser-bootstrap.ts" OPENGRANTER_PORT=8081 node --experimental-strip-types scripts/start-sso-browser.ts
```

Use a separate explicitly selected port alongside the proxy. Defaults remain loopback. This command is not deployment/ingress approval. Replace the reviewed public JWKS and restart to rotate trust; no hot reload is claimed. Never substitute an ID token or proxy token for an API-specific access token. Browser cookie sessions, login redirects, company IdP, TLS ingress, real PostgreSQL recovery and installed acceptance remain independent gates.
