# Canonical read-only review process (#637, #643)

This explicit launcher serves a reviewed public artifact and the canonical signed-SSO model list/detail, usage JSON/CSV and audit JSON/CSV APIs on one owned listener. It does not replace `npm start` or the existing SSO token-management launcher.

## Trusted module

Create an operator-owned absolute-path TypeScript module outside public assets. It must export `createCanonicalReviewPorts`. Reuse the existing configuration loader if appropriate:

```ts
import { loadSsoBrowserBootstrap } from '/absolute/checkout/src/gateway/sso-operator-bootstrap.ts';
import { createPostgresConnection } from '/absolute/checkout/src/storage/postgres-connection.ts';

export async function createCanonicalReviewPorts() {
  const ports = await loadSsoBrowserBootstrap(process.env, () => createPostgresConnection({
    // Use the approved pg environment/TLS configuration; do not embed credentials.
  }));
  if (!ports.browserArtifactSha256) throw new Error('Reviewed artifact pin required');
  return { ...ports, browserArtifactSha256: ports.browserArtifactSha256 };
}
```

The loader requires `OPENGRANTER_SSO_ISSUER`, `OPENGRANTER_SSO_AUDIENCE`, `OPENGRANTER_SSO_JWKS_PATH` and `OPENGRANTER_BROWSER_ARTIFACT_PATH`. This launcher additionally requires `OPENGRANTER_BROWSER_ARTIFACT_SHA256`, the exact reviewed lowercase SHA-256. Keys must be pre-registered public keys; no remote discovery or key download occurs. The artifact is snapshotted and verified before SQL is opened. Never store a password or private key in the module or public artifact.

## Explicit execution

After obtaining deployment/configuration approval and preparing the reviewed artifact and PostgreSQL target, from the matching checkout with Node >=22.14:

```sh
OPENGRANTER_BOOTSTRAP_MODULE=/absolute/operator/canonical-review.ts \
OPENGRANTER_HOST=127.0.0.1 OPENGRANTER_PORT=8080 \
node --experimental-strip-types scripts/start-canonical-review.ts
```

The local public shell is at `http://127.0.0.1:8080/management`. This is an example address, not a running deployment. The process owns migrations, the listener, a real clock and random request IDs. SIGTERM/SIGINT trigger the existing bounded shutdown; `OPENGRANTER_SHUTDOWN_MS` defaults to 30000. Fixed diagnostics do not expose SQL, file paths or credentials. Legacy bootstrap factory names are rejected, not silently substituted.

The shell is public and is not an SSO session. API requests still require the approved signed bearer access token and fresh registered identity/policy checks. Cookies do not authenticate. No login/logout, BFF, CSRF, CORS, IdP, ingress/TLS or provider changes are included. Do not paste bearer tokens into the shell. This command is not approval to deploy or run paid calls.

## Evidence boundary

Loopback/PGlite tests exercise real Fetch requests, signed JWTs, migrated model list/detail, usage/audit JSON and CSV, denial, revocation, audit loss and signal shutdown. CLI tests separately exercise real executable failure diagnostics. These do not certify installed PostgreSQL, native browser login, external IdP, provider inference, or operational recovery.
