# Published model information in operations

## Issue and problem
- Issue #637, related #641. Operations model details currently hide already-published descriptive metadata, context/output bounds, capabilities and base rates.

## Scope and expected behavior
- Display existing validated SSO metadata in the opt-in operations detail screen. Preserve exact strings and zero values. Explicit null is Unknown; absent metadata is Not published; empty label arrays are None published. No inferred capability or billing.
- Out of scope: CRUD, provider calls, authentication, public entry, routing decisions, migrations or provider verification. Existing IAM, mandatory read audit and session teardown remain authoritative and unchanged.

## Design
- Add operations-model-details.ts as a text-only supplementary section to operations-catalog.ts after existing detail rendering. Do not modify frontend-owned catalog renderer/client/session/entry. Keep old basic fields and navigation. Use existing CatalogModel projection, never inspect raw transport fields.
- No irreversible decisions or new domain terms. Contracts: contracts/management-operations.md and contracts/sso-model-catalog.md. Update docs/PRD.md, docs/architecture.md and docs/acceptance.md.
- Depends on PR912 for operations integration. Session acquisition and installed activation remain external dependencies, not certified by this slice.

## TDD plan
- Add public mount tests before coding: full rich detail appears as text; zero/null/absent/empty values remain distinct; metadata clears on navigation, failure and terminal denial; malformed metadata fails closed in existing parser. Verify bundle closure.
- Record RED for hidden published metadata, then implement the smallest supplementary renderer. Run targeted management tests, full typecheck/lint/planning/compatibility and attempt npm run check.

## Delivery
- Issue branch and dependent draft PR; DCO and AI disclosure. Exact-head required CI and independent formal approval before merge. Rollback removes supplemental view with no migration.
- Synthetic tests are not installed SSO/database/provider or user deployment evidence.

## Verification checkpoint
- RED: 1/4 passed; three expected behavior failures because published detail metadata was hidden. GREEN: 8/8 new public-mount cases pass, zero skipped.
- Focused operations/session/SSO catalog: 71/71 pass, zero skipped. Broad management: 493/494 pass, zero skipped; only CLI artifact smoke fails because installed npm lacks walk-up-path. Aggregate npm run check fails before repository scripts for the same missing npm dependency; not a full-check PASS.
- Direct complete TypeScript check exits zero; complete Biome exits zero (existing warnings/info retained). Planning links/contracts, all six compatibility pins and git diff whitespace pass.
- Canonical bundle native browser preview on http://127.0.0.1:18814: History to Models to demo/model; all ten metadata fields, exact decimal/scientific prices, null Unknown, and literal script-like description verified. Responses are explicitly synthetic. Preview-only entry removed before commit. Not real SSO/API/provider or user-accessible test deployment.
- PR912 dependency exact base 037ef639021f27a43dea0cc0468fd8940fe9d539. No public entry/session source, other owners files, production or paid calls changed.
