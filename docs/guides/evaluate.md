# Evaluate OpenGranter locally

This guide evaluates the source checkout and its executable contracts. It does not deploy a service, provision provider credentials, or start a management UI.

## 1. Prepare the toolchain

Use Node.js **22.14 or later**, npm, Git, and Python **3.11 or later**. The repository targets Node.js 22 in its harness documentation. Check your active tools before installing dependencies:

```sh
node --version
npm --version
python3 --version
git clone https://github.com/Theorvane/OpenGranter.git
cd OpenGranter
npm ci
```

Use the committed lockfile. There is no documented `npm start`, Docker Compose deployment, or published package install path in this checkout; do not infer one from the HTTP modules.

## 2. Inspect the authorization boundary first

Run focused, credential-free policy and route contracts:

```sh
node --experimental-strip-types --test --test-reporter=spec \
  test/policy.contract.test.ts test/route.contract.test.ts
```

Read the corresponding [policy fixtures](../../contracts/policy_cases.json) and [route fixtures](../../contracts/route_cases.json). These cases exercise authorization decisions such as default denial and allowed candidate filtering. They do not call live upstreams or prove an entire deployment secure.

The [README capture](../../assets/contract-checks.svg) is an actual output capture of this command, with a [transcript and provenance notes](../../assets/README.md). Timing varies across machines.

## 3. Run the repository gate

```sh
npm run check
```

The gate runs type checks, linting, tests, the planning-document checker, and offline compatibility pin checks. See [the harness](../harness.md) for exact responsibilities. Passing checks are evidence for the tested modules and fixtures, not evidence of live provider behavior or operational readiness.

A real PostgreSQL integration test requires an explicit test URL. Without one, those cases skip; embedded database and unit tests still run. Review skipped tests rather than reporting them as exercised integrations.

### Optional: disposable PostgreSQL

CI uses PostgreSQL 17. Point this command only at a disposable local test database:

```sh
OPENGRANTER_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run check
```

This example assumes a localhost test database configured without a password. **Do not use that authentication configuration for production.** Integration tests create uniquely named schemas, apply migrations, and remove them. They still require appropriate schema privileges; never point them at production or valuable shared data. Keep any real connection credentials out of Git, screenshots, and logs.

## 4. Select a compatible workflow using evidence

Read [OpenRouter compatibility and setup](../openrouter-compatibility.md) before configuring a client. The supported surface is bounded: do not equate an OpenAI-compatible chat path with every OpenAI or provider-native API.

- [AI SDK conformance](../ai-sdk-conformance.md) records the pinned client's measured workflows.
- [OpenCode conformance](../opencode-conformance.md) records controlled external-tool behavior and its limits.
- `npm run compatibility:check` validates reviewed structural pins offline; it does not certify all schema instances or clients.
- `npm run compatibility:drift` explicitly fetches the public upstream schema, performs a bounded comparison, and does not update pins or call inference. It needs network access, not provider credentials. Review drift through an issue and PR.

## 5. Understand what deployment still owns

Do not expose a bare test fixture or module assembly as a production gateway. Review [architecture](../architecture.md), [routing](../routing.md), [acceptance](../acceptance.md), and [the roadmap](../roadmap.md), including these responsibilities:

- Trusted configuration, registered upstream hosts, secret-manager references, and key rotation.
- Identity provisioning, policy administration, revocation, and scoped management operations.
- Database migration execution, connection ownership, and orderly shutdown: close HTTP before awaiting database close so active requests can finish.
- TLS, network policy, limits, monitoring, retention, backup/recovery, and environment-specific security/load/failure checks.
- Usage reconciliation and explicit treatment of missing usage, estimated cost, and possibly billed failed attempts.
- Remaining startup, management, and operational release gates. A passing local harness does not complete them.

`createPostgresConnection` in `src/storage/postgres-connection.ts` exposes query, transaction, and close ports; creating it does not run migrations or start HTTP automatically. See [PostgreSQL driver ownership](../architecture.md#postgresql-driver-ownership).

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| TypeScript syntax cannot run directly | Check the active Node version and use the documented `--experimental-strip-types` command |
| `npm ci` fails | Confirm the Node/npm toolchain and registry connectivity; do not rewrite the lockfile as a workaround |
| PostgreSQL cases skip | Supply an explicit disposable test URL if you intend to exercise the real driver |
| Live schema drift fails | Check network availability and review differences; do not silently regenerate reviewed pins |
| A client feature appears unsupported | Consult its exact compatibility/conformance case instead of assuming provider parity |

To contribute improvements, follow [CONTRIBUTING.md](../../CONTRIBUTING.md) and the [plan template](../plans/TEMPLATE.md).
