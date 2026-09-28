# OpenRouter client base paths

## Issue and problem

- Issue: [#115](https://github.com/Theorvane/OpenGranter/issues/115).
- The contributor requires external tools to register and use OpenGranter compatibly with OpenRouter. Current /v1-only dispatch rejects the /api/v1 base used by OpenRouter clients.
- Current request/response support remains a partial text-chat subset; path compatibility alone cannot certify full compatibility.

## Scope and expected behavior

- Add exact POST /api/v1/chat/completions and GET /api/v1/models alongside existing /v1 paths.
- Share authentication, IAM, limits, routing, audit and per-attempt usage. Both managed and delegated routes work through the new chat path.
- Document the external-client compatibility target and remaining gates, and retain it in AGENTS.md as a standing contribution rule; retain existing unsupported-field denial until each field is implemented and tested.
- No broad prefix rewrites, provider-key exposure, model metadata invention, SSO implementation or completed streaming/tool-calling claim.

## Design

- Match the two additional paths directly in the shared dispatcher; all server/runtime compositions inherit it. Do not redirect POST bodies or duplicate coordinators.
- A broad prefix rewrite could expose OpenGranter-specific audit/usage extensions under unrelated OpenRouter paths; explicit dispatch avoids that ambiguity.
- Record the agreed OpenRouter client compatibility term in [CONTEXT.md](../../CONTEXT.md).
- See [compatibility matrix](../openrouter-compatibility.md), [contract](../../contracts/openrouter-client-paths.md), [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md).
- The full external-client target now requires streaming and tool-call workflows. Their implementation, interruption accounting and provider capability mappings remain tracked work, rather than silently implemented options.

## TDD plan

- Public handler red cases for managed/delegated chat, IAM-filtered models, authentication/explicit Deny/limit/mandatory audit failures on /api/v1.
- Verify exact path/method matching; unknown and administrative-extension lookalikes remain unavailable.
- Add a real Node socket round-trip using the /api/v1 client base, proxy Bearer token and optional app-identification headers.
- Implement direct dispatch aliases, format and run npm run check.

## Delivery

- English issue/plan/contract precede tests and code; report red/green and full checks.
- No migration. New paths share the existing security boundary; rollback removes only aliases. Full OpenRouter compatibility remains an explicit release gate.

## Verification evidence

- Full compatibility tracking remains open in [#116](https://github.com/Theorvane/OpenGranter/issues/116).
- Red: nine of ten new public HTTP/socket cases failed with missing /api/v1 dispatch; exact-path rejection baseline passed.
- Green: all ten cases pass, including managed/delegated parity, filtered discovery, auth/IAM/limit/required audit failures and a real Node socket using client headers/base URL.
- npm run check passed strict TypeScript, Biome, 484 tests and planning/link/contract/fixture scanning. One external PostgreSQL test skipped locally without a database URL; CI supplies PostgreSQL.
- git diff --check passed. CLAUDE.md remains linked to AGENTS.md. No migration or live upstream calls.
