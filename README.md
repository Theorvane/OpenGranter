# OpenGranter

OpenGranter is a planned gateway for controlling LLM access by user and role and reviewing usage and audit records. It supports an OpenRouter-delegated route for existing OpenRouter users and a managed route to registered direct providers. This repository contains planning documents, an engineering harness, gateway modules, and PostgreSQL adapters. Deployment startup, management APIs, and other release gates remain under development.

The repository includes [grill-with-docs](skills/grill-with-docs/SKILL.md) and its two required skills. They are also installed in the Codex user skill directory. Planning interviews resolve decisions in rounds, capture agreed terms in [CONTEXT.md](CONTEXT.md), and record qualifying architectural decisions in `docs/adr/`. The skills come from [mattpocock/skills](https://github.com/mattpocock/skills); their license is preserved in [skills/LICENSE](skills/LICENSE).

Repository documentation is written in English. [CLAUDE.md](CLAUDE.md) is a symbolic link to [AGENTS.md](AGENTS.md), so both agent entry points always use the same instructions.

Contributions follow the [issue, branch, and pull-request workflow](CONTRIBUTING.md), including DCO sign-off by a human contributor and disclosure of material AI assistance.

## Documents

- [Product requirements](docs/PRD.md)
- [Architecture and open decisions](docs/architecture.md)
- [Acceptance scenarios](docs/acceptance.md)
- [Roadmap](docs/roadmap.md)
- [OpenRouter client compatibility and setup](docs/openrouter-compatibility.md)
- [Engineering harness](docs/harness.md)
- [TypeScript coding rules](docs/coding.md)
- [Name decision](docs/naming.md)
- [OpenRouter feature comparison](docs/research/openrouter-comparison.md)
- [OpenRouter control-layer review](docs/research/openrouter-layer-review.md)
- [Dual upstream routing decision](docs/adr/0003-dual-upstream-routing.md)
- [Routing and authorization contract](docs/routing.md)
- [Final inference provider authorization decision](docs/adr/0004-authorize-final-inference-provider.md)

## Run the harness

Use Node.js 22 and npm. Python 3.11 or later is required for the planning-document checker.

```sh
npm ci
npm run check
```

The command checks TypeScript types, formatting, linting, policy and route-authorization contract tests, document links, contract structure, and common credential patterns in fixtures. The gate also validates the pinned OpenRouter chat, supported model-query and model-response structural projections offline. More service tests will be added as implementation proceeds.


## PostgreSQL integration checks

CI runs the complete checks against a disposable PostgreSQL 17 service. To run the same driver integration locally, supply a test database URL to the check process:

```sh
OPENGRANTER_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres npm run check
```

Use only a disposable database; the integration test creates a uniquely named schema, applies the migrations there, and removes it afterward. The example assumes a localhost test database configured without a password. Never use that authentication configuration for production. Without the explicit test URL, the real PostgreSQL integration test skips; unit and embedded database tests still run.

`createPostgresConnection` in `src/storage/postgres-connection.ts` accepts trusted node-postgres configuration and returns query, transaction, and close ports. Pass it to the PostgreSQL gateway factory and migration runner; it does not run migrations or start HTTP automatically. Close HTTP before awaiting database `close()` so active requests can finish. See [driver ownership](docs/architecture.md#postgresql-driver-ownership) for failure handling and deployment responsibilities.


## OpenRouter schema drift

`npm run compatibility:check` validates the reviewed chat, supported model-query and model-response pins without network access and is included in `npm run check`. Run `npm run compatibility:drift` explicitly to compare all three selected structural projections against one bounded retrieval of the official public schema; it performs no inference, sends no credentials, and does not update any pin. Review differences through an issue and pull request before updating provenance and contract expectations.

This covers selected chat definitions, eight model query objects and 21 model response definitions, not full instance validation, all referenced targets or complete external-client certification. See [chat coverage and limitations](contracts/openrouter-schema-drift.md) and [model-query coverage and limitations](contracts/model-query-schema.md), and [model-response coverage and limitations](contracts/model-response-schema.md).
