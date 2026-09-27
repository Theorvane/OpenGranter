# TypeScript Coding Rules

OpenGranter's service and future management UI use TypeScript. The repository currently implements only the first pure policy-evaluation slice; framework, database, and UI library choices remain open.

## Toolchain

- Use Node.js 22 and npm with the committed `package-lock.json`. Install with `npm ci`.
- Use ESM and explicit `.ts` extensions for local imports. Import types with `import type` or inline `type` modifiers.
- Keep `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` enabled. Do not add broad `@ts-ignore` comments or weaken `tsconfig.json` to make a change pass.
- Use `npm run format` before review and `npm run check` as the local and CI gate. Biome owns code formatting and linting; TypeScript owns type checking.

## Code design

- Keep policy evaluation and other domain rules pure: no database, network, clock, or environment reads in domain functions. Pass required inputs explicitly.
- Validate untrusted HTTP, provider, database, and fixture data at boundaries. Use `unknown` until validated; avoid `any` and unsafe assertions in production code.
- Depend on narrow interfaces for secret storage, persistence, identity, and providers so AWS and on-premises adapters can be tested against the same behavior.
- Use descriptive domain names from `CONTEXT.md`. Use `camelCase` for values/functions, `PascalCase` for types, and `kebab-case` for file names. Match external API field names only at adapters.
- Prefer small, explicit functions and discriminated unions for expected outcomes. Preserve the cause when rethrowing unexpected failures.
- Never use floating-point arithmetic for billed money. Keep currency, source, and precision explicit; mark estimates as estimates.

## Security and observability

- Follow the security invariants in `AGENTS.md`. Authentication, authorization, and limits precede any provider call.
- Keep secrets and prompt/response content out of normal logs, error objects, and audit-event payloads. Content auditing uses its separate protected store only when enabled.
- Accept provider destinations only from trusted administrator configuration. Never forward a caller-controlled URL.
- Attach a request ID to decisions, usage events, and provider calls; do not treat missing token usage as zero.

## Tests and review

- Test behavior through public module boundaries. Run shared cases in `contracts/` against the implementation instead of copying the evaluator's logic into tests.
- For permission changes, cover implicit Deny, explicit Deny precedence, wildcard matching, inactive principals, and action/resource mismatches.
- For provider and persistence adapters, use fakes for routine tests and focused integration tests for failure paths. Avoid live provider calls in CI.
- Keep tests deterministic: control time, identifiers, and external responses. Do not put real credentials or customer content in fixtures.
- Update acceptance scenarios and contract cases when product behavior changes; record unresolved product choices as open decisions.

## References

- [TypeScript strict configuration](https://www.typescriptlang.org/tsconfig/)
- [Node.js TypeScript type stripping](https://nodejs.org/api/typescript.html)
- [Biome linting and formatting](https://biomejs.dev/linter/)
