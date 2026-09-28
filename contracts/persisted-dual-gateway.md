# Persisted dual-route gateway composition contract

`createPostgresDualRouteChatHandler(ports)` and `createNodePostgresDualRouteChatServer(ports)` compose the existing PostgreSQL gateway with direct and OpenRouter adapters. The server is unbound; the caller applies migrations and owns listen/close/database resources.

- Required infrastructure ports remain `client`, `now`, `newRequestId`, `checkLimit`, and `resolveSecret`. Optional `fetcher`, `timeoutMs`, and `fetchJev` retain their existing adapter meaning. Transport/timeout settings apply to direct and OpenRouter calls; omitted settings preserve adapter defaults.
- Callers no longer supply `invokeDirect`, `invokeOpenRouter`, or `resolveVerifiedProviderSlug`. The composition supplies those adapters after any extra runtime fields, preventing an accidental override of the generated ports.
- Construction loads the enabled direct registration snapshot but does not retrieve secrets or call a provider. An empty registration set supports delegated-only deployments. Safe registration-load errors reject construction before a server is returned.
- Requests use the existing non-streaming text chat, models, usage, and audit contracts. Current principal/role policies filter both route kinds; model and final-provider permissions apply together.
- Delegated routes use their stored credential reference, fixed OpenRouter endpoint, and only resolved IAM-eligible enabled/verified provider slugs. No caller routing override or arbitrary host is accepted.
- Missing mappings, policy Deny, limit denial, credential revocation, and required pre-call audit failure prevent upstream calls. Secret lookup failure prevents transport. Upstream failure returns existing safe gateway errors without replay through direct providers.
- Both route kinds persist content-free attributed audit and per-attempt normalized usage through the existing stores. Secrets, raw proxy tokens, prompts, and responses do not enter these histories.
- Direct registration updates require rebuilding composition. Mappings are read per lookup; configuration changes after reads are not revalidated. Runtime startup, SSO, management endpoints, secret/limit implementations, and provider discovery are not supplied by these factories.

## Executable cases

`test/postgres-dual-http-server.test.ts` exercises the composed socket boundary, both route kinds, persisted history, denials/failures, delegated-only operation, and bootstrap failures with fake upstream transport and embedded PostgreSQL.
