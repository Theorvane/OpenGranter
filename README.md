# OpenGranter

OpenGranter is a planned gateway for controlling LLM access by user and role and reviewing usage and audit records. It supports an OpenRouter-delegated route for existing OpenRouter users and a managed route to registered direct providers. This repository currently contains **planning documents and an engineering harness**; the service is not implemented yet.

The repository includes [grill-with-docs](skills/grill-with-docs/SKILL.md) and its two required skills. They are also installed in the Codex user skill directory. Planning interviews resolve decisions in rounds, capture agreed terms in [CONTEXT.md](CONTEXT.md), and record qualifying architectural decisions in `docs/adr/`. The skills come from [mattpocock/skills](https://github.com/mattpocock/skills); their license is preserved in [skills/LICENSE](skills/LICENSE).

Repository documentation is written in English. [CLAUDE.md](CLAUDE.md) is a symbolic link to [AGENTS.md](AGENTS.md), so both agent entry points always use the same instructions.

Contributions follow the [issue, branch, and pull-request workflow](CONTRIBUTING.md), including DCO sign-off by a human contributor and disclosure of material AI assistance.

## Documents

- [Product requirements](docs/PRD.md)
- [Architecture and open decisions](docs/architecture.md)
- [Acceptance scenarios](docs/acceptance.md)
- [Roadmap](docs/roadmap.md)
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

The command checks TypeScript types, formatting, linting, policy and route-authorization contract tests, document links, contract structure, and common credential patterns in fixtures. More service tests will be added as implementation proceeds.
