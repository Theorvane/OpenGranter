# Official OpenRouter request schema drift

## Issue and problem

- Issue: [#138](https://github.com/Theorvane/OpenGranter/issues/138), compatibility parent #116.
- Hand-authored field contracts lack a pinned official schema reference and a repeatable drift signal. The retrieved ChatRequest declares eight implemented fields but no n property.

## Scope and expected behavior

- Pin structural definitions of model, messages, stream, max_tokens, max_completion_tokens, stop, temperature and top_p, plus request reference/required fields and specification versions.
- Check snapshot integrity offline in the standard gate. Offer an explicit fixed-host, read-only network comparison with bounded time/bytes; fake sources cover failures in CI.
- Ignore examples/descriptions and unrelated endpoints. Preserve meaningful schema keywords. Keep n=1 explicitly local/SDK support rather than claiming it appears in the retrieved schema.
- No gateway, IAM, audit, usage, credentials or provider behavior changes. This is partial drift infrastructure; unresolved referenced schemas, responses, streaming/tools and full schema validation remain open.

## Design

- Store a compact JSON projection and provenance manifest under contracts with raw source and canonical projection SHA-256. Retain source attribution and avoid vendoring unrelated content.
- TypeScript helpers validate the expected document path and compare deterministic projections. Separate CLI file/network orchestration from pure projection/integrity functions.
- Network access is explicit, uses the fixed official URL without credentials/redirects, and fails safely on transport, timeout, oversized body or malformed schema. Never auto-update a pin.
- Runtime JSON Schema validation would introduce a broader schema implementation/dependency; defer it until its supported surface is defined. References remain visible rather than being silently treated as validated.
- Update [compatibility inventory](../openrouter-compatibility.md) and [contract](../../contracts/openrouter-schema-drift.md). No domain or irreversible product decision is introduced.

## TDD plan

- Write projection/integrity and CLI tests first: unchanged source succeeds; type/required/reference changes fail; editorial/unrelated changes pass; malformed documents/pins fail; transport/time/size failures are safe.
- Use deterministic synthetic official-shaped sources and a pinned-source integrity case. Record expected red, minimal implementation and green.
- Run focused strict type/Biome checks, offline CLI and full npm run check. A one-time explicit live drift check verifies the source pin without involving real keys or inference.

## Delivery

- Create issue/branch and plan, capture public provenance, add regressions, implement helpers/CLI, integrate offline npm gate, then ready PR.
- Pin updates require review of official differences and local contract gaps. A changed selected definition can block a release claim; editorial or unrelated changes do not trigger structural drift.
- Report limited coverage and raw-vs-projection hashes; keep #116 open.

## Verification evidence

- Red: the eight-case public helper/fetch suite produced four failures and four passes against the unimplemented helper boundary. A later property-name/literal-default regression failed once (eight passes) before the annotation filter was corrected.
- Green: all eleven cases pass, including integrity/projection, structural drift, ignored editorial changes, safe download failures/deadline and CLI success/rejection. CLI subprocess tests require process execution; the initial restricted sandbox run denied child creation, and the permitted run passed.
- Focused Biome with `--error-on-warnings`, strict TypeScript and diff checks passed. The explicit live drift command matched the selected definitions from the official source.
- `npm run check` passed: 640 tests pass, one optional external PostgreSQL case skipped, type/lint/planning/contract/fixture gates pass and the new offline integrity check passes. No keys or inference calls were involved.
