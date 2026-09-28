# PostgreSQL OpenRouter provider mapping contract

`createPostgresOpenRouterProviderMappingResolver(client)` returns a function compatible with the delegated gateway's `resolveVerifiedProviderSlug(providerId, upstreamModelId)` port.

- Provider IDs are nonempty strings of at most 256 characters. Upstream model IDs and returned slugs satisfy the existing OpenRouter adapter's bounded slug syntax.
- Lookup uses both requested IDs as bound SQL parameters. It resolves only the exact model/provider pair when `enabled` and `verified` are both true. Missing or disabled/unverified rows return `undefined`.
- Every returned row must identify the requested provider and model, contain valid slug syntax, and retain both true flags. Duplicate/out-of-scope/malformed results throw `OpenRouterProviderMappingUnavailable`; no partial mapping is returned.
- Invalid inputs throw `InvalidOpenRouterMappingLookup` before SQL. Storage failures throw a fixed `OpenRouterProviderMappingUnavailable` without driver details, secrets, or causes.
- Migration `009` adds a primary key on provider/model and a unique enabled/verified model/slug index, preventing multiple IAM identities from simultaneously asserting the same OpenRouter destination for a model.
- `verified` is an explicit administrator attestation. This reader performs no provider discovery or automatic verification. Configuration writers and their audits are not implemented here.
- The existing coordinator filters IAM candidates before looking up mappings. It forwards only resolved authorized slugs; missing mappings stop before limits/inference. The resolver alone does not authorize a caller or invoke upstream services.
- Each call reads current database state; changes after a read are not revalidated before inference. Multiple candidates do not share a transaction snapshot. The coordinator still rejects duplicate resolved slugs.

## Executable cases

`test/postgres-openrouter-mappings.test.ts` covers exact scope, activation/verification, conflicts, parameter binding, boundary failures, and delegated IAM/inference behavior. Migration and bundle tests cover deployment sources and idempotent application.
