# #637 Usage screen integration

## Issue and problem
- Issue: #637; stacked on #699 exact 5dc0f3ccb37d2a9a66059f3e1cc187282b50d311.
- The usage browser client has no screen consumer. This base does not contain the separate #676 catalog app/view/entry; do not overwrite that branch.

## Scope and design
- New `src/management/usage-app.ts` exports `mountManagementUsage(root)` with `connect(alreadyAuthorizedRequest)`, `clear(reason)`, and `dispose()`.
- Native DOM controls and safe textContent render loading, empty, error, filters, opaque next cursor and current-page CSV download. No framework or dependencies added.
- Missing tokens/cost remain Unknown; estimates and billed costs stay distinct. Usage status, possible billing and duplicate flags remain visible.
- CSV is a single page, not a full export. Blob URLs are revoked on new reads, identity clear and disposal.
- Owner must connect only an authorized request and clear on logout, expiry, identity or permission change. Mount makes no request. No token acquisition/storage, runtime HTTP mounting, session bridge or schema activation.
- Actual session owner and authorized transport composition are unresolved blockers, not supplied by this screen. Catalog list/detail contract remains separate.

## Validation and delivery
- Structural DOM test plus real loopback HTTP handler/client/screen integration covers loading, rows, empty, filters, paging, CSV and safe output; service behind handler is a fake, not a production identity proof.
- 400/401/403/503, late response invalidation, identity reconnect and disposal cases.
- Initial test failed due to unsupported TypeScript parameter property; fixed to explicit field. Next HTTP test exposed invalid fake cursor; fixed test data to an actual encoded usage cursor. Neither is claimed as behavior-first TDD evidence. Plan was recorded after initial code drafting, a workflow deviation.
- Run typecheck, targeted Biome, focused app+client tests and esbuild browser bundle. Full check and browser status must be reported separately.
- Rollback: omit importing the module. No existing entry, session or server file is modified.

## Verified results
- Focused app + client: 15/15 pass, zero skipped. HTTP fixture paging consistency was also corrected (empty pages cannot advertise more records).
- Typecheck passed; full Biome exited 0 with pre-existing warnings/info. esbuild browser bundle passed (20.9 KiB, rebuilt after metadata columns).
- Visual browser attempt failed: both page browser and desktop observation report screen still being released. No authenticated browser proof.
- Planning/link/fixture secret checker passed; final typecheck passed after added validation/revocation tests. Full test suite/compatibility pending at time of this note. See contracts/usage-screen.md for composition obligations.
