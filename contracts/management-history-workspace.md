# Shared management history workspace

`createHistoryWorkspace(request, onChange?)` composes the canonical usage and audit review APIs for one caller-owned already-authorized request port. It authenticates nobody, obtains no token, and creates no session. The caller must dispose the workspace on logout, known expiry or identity change, and recreate only with newly approved authority.

## Public behavior
- `usage` and `audit` retain their existing load/next/previous/retry/explicit export interfaces and independent filters/cursors. No automatic CSV download, polling, mutation or replay.
- `snapshot()` returns a frozen `{ state, usage, audit }`; state is active, unauthenticated, denied or disposed. Child rows use existing redaction, bigint and exact-cost projections. Workspace state, not the disposed child idle state, selects the terminal UI boundary.
- A fresh un-aborted 401/403 response from either JSON or CSV operation terminally changes workspace state to unauthenticated/denied before aborting both children. Both histories and pending exports are cleared. Retained child methods cannot reuse the old port. Creating another workspace does not confer new authority; server-side fresh SSO/IAM remains mandatory.
- The terminal observer notification contains both children already cleared. Intermediate disposal notifications are suppressed. Observer exceptions cannot interrupt invalidation; reentrant disposal during loading prevents transport.
- Abort/replacement/timeout makes a late response stale; stale 401/403 does not terminate current work. Clients still discard response bodies. Late success cannot restore disposed data.
- HTTP 400/500, malformed pages and transport failure stay local to the initiating review and preserve the sibling. Existing explicit retry is retained. No credentials or raw error text enters snapshots.
- Workspace disposal is idempotent and preserves an already terminal reason. Call the workspace disposal method for identity teardown, not an individual child method. Do not persist previously handed-out immutable snapshots or CSV strings; disposal clears owned state, not external copies or committed server audits.

## Evidence and exclusions
`test/management-history-workspace.test.ts` covers JSON/CSV denial in both directions, shared cancellation, stale-port blocking, stale denial, local failures, observers and disposal. `test/management-history-workspace-integration.test.ts` builds the real canonical artifact and executes it against the owned management listener over actual loopback HTTP, with signed fixture JWTs, current IAM, migrated PGlite and durable access audit. It also verifies the served public artifact bytes.

This is application integration API evidence, not native browser rendering/login, company IdP, installed PostgreSQL, provider calls, deployment approval or completed navigation. Existing frontend entry/navigation and backend session ownership remain unchanged. No retention/content-audit setting or IAM authority is introduced.

Canonical browser builds include only the reviewed pure Unicode validator as an additional transitive shared dependency. It cannot be a browser entry; no directory-wide shared/server allowance is introduced. See [plan](../docs/plans/642-history-browser-unicode-closure.md).


## Active history filter reset (#642)

The explicit Reset filters action starts one fresh authorized JSON read for the active Usage or Audit view. It clears applied/draft request, model, time, page-size and cursor state, restores the mount's optional initial principal target exactly, and leaves the sibling view unchanged. Pending reads/CSV preparation are cancelled by existing review ownership; late results and detached controls cannot revive data after reset, disposal or denial. Invalid filters can be reset without sending an invalid query. This action does not grant scope, bypass server authorization, enable retention or certify complete history. See [implementation plan](../docs/plans/642-history-filter-reset.md).
