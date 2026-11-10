# Explicit SSO browser process

Run node --experimental-strip-types scripts/start-sso-browser.ts only after deployment approval. Separate process, never activated by npm start. Absolute OPENGRANTER_BOOTSTRAP_MODULE exports createSsoBrowserPorts returning openConnection, issuer, audience, jwks, browserArtifactPath and optional migrationDirectory. Database secrets stay inside the connection factory. No provider credentials or user tokens.

Existing OPENGRANTER_HOST, OPENGRANTER_PORT and OPENGRANTER_SHUTDOWN_MS configuration applies. Defaults: loopback, 8080, 30000ms. Choose a distinct explicit port beside the proxy. Executable owns host/port/now/newRequestId. Full artifact/JWT/migration validation remains in reviewed runtime factories. Fixed diagnostics redact all underlying errors. SIGTERM/SIGINT close HTTP before database within the existing deadline; interrupted startup cannot announce readiness.

Bearer authentication, fresh human binding, IAM and mandatory audit remain unchanged. Cookie sessions/BFF/IdP/TLS/live PostgreSQL/installation remain separate gates. No default activation, paid calls or new schema.
