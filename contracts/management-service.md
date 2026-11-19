# Explicit management service executable

Refs #639/#641, [owned runtime](sso-management-runtime.md) and [plan](../docs/plans/639-management-service.md).

`npm run management:start` starts **only** the separate management runtime. It is never activated by `npm start` or by an HTTP request. Set `OPENGRANTER_MANAGEMENT_BOOTSTRAP_MODULE` to an absolute trusted deployment module exporting `createManagementPorts()`. The factory returns `openConnection`, registered `issuer`, API-specific `audience`, RS256 public `jwks`, and optionally `browserJavascript` containing only the trusted public bundle. The runtime validates its SSO configuration and migrations before listening. This executable does not provision SSO bindings, fetch arbitrary issuer keys, create sessions or expose an inference endpoint.

Optional management-only settings:
- `OPENGRANTER_MANAGEMENT_HOST`: default `127.0.0.1`.
- `OPENGRANTER_MANAGEMENT_PORT`: default `8081`, integer 1–65535.
- `OPENGRANTER_MANAGEMENT_SHUTDOWN_MS`: default `30000`, integer 1–2147483647.

Inference `OPENGRANTER_BOOTSTRAP_MODULE/HOST/PORT/SHUTDOWN_MS` values are not fallback inputs. Process configuration overrides any factory-supplied host/port/clock/request-ID fields; the process supplies server time and UUID request IDs. Use a separate process and explicit ingress/TLS configuration. The bootstrap file is executable trusted operator code, not an upload or request field; do not put credentials in public browser bundles.

The shared process lifecycle validates configuration before importing code, reports only fixed generic gateway diagnostics, closes once on SIGTERM/SIGINT and enforces a non-resetting shutdown deadline. Shutdown during import/factory suppresses startup; late startup is closed without reporting readiness. Existing inference behavior is unchanged. Readiness means the configured owned runtime is listening, not successful company SSO, installed PostgreSQL, browser login or provider E2E.

No default deployment, production activation or paid call is authorized by this entrypoint.
