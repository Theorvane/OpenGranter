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


## Usage attempt inspection (#642)

Each validated scoped usage row offers a native Inspect usage attempt disclosure. It shows attempt ID, route kind, recorded upstream target, selected candidate, reported inference provider, outcome, latency in milliseconds, usage availability and input/output/total token counts. Null counts/provider/candidate remain Unknown and zero stays zero. The upstream target is not proof of the actual model served; rows represent attempts, not request aggregates. Existing exact estimated/reported cost and duplicate/possibly-billed markers remain unchanged.

The disclosure uses only existing authorized response data and text nodes; it adds no network calls, credential/policy display, authentication, public entry activation, retention or schema. Reload/filter/denial/navigation/identity disposal remove the prior disclosure with the row. See [plan](../docs/plans/642-usage-attempt-details.md) and contracts/management-history-workspace.md. Local signed-fixture SSO HTTP plus migrated embedded PostgreSQL is not installed IdP/PostgreSQL/provider acceptance.
