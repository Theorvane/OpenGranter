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

## Canonical filter focus continuity (#988)
Asynchronous same-tab history renders preserve focus and selection only for the currently focused filter draft. External focus and tab changes never trigger restoration. Denial and disposal clear private filters without refocusing them. UTC draft text, applied request/CSV scope and authorization remain unchanged. Source980 is only partially integrated. See test/history-filter-focus.test.ts and the #988 plan.

## Canonical tab departure CSV cancellation (#988)
Leaving Usage or Audit cancels only its pending CSV delivery. Abort the export request and retire its completion before selecting the destination. A late success cannot save a file; a late403 from that aborted export cannot terminate the current identity epoch. Returning to an authorized ready/empty page still requires a fresh read. Preserve the existing pending JSON coalescing contract; tab departure does not revoke authority or erase an already downloaded file.

## Canonical Audit-to-Usage request investigation (#994)
An authorized Audit row can open Usage for its exact request ID. Intersect destination applied Usage principal/model/time/page-size filters, clear its cursor and unapplied drafts, and require a fresh Usage read. Never copy Audit scope or infer Usage permission from Audit visibility. Canonical tab departure cancels pending CSV delivery; stale responses/controls cannot download or restore data after denial/disposal. Empty results are not proof of no provider call, bill, or complete history. Preserve pending JSON coalescing and all existing session/activation gates. See [plan](../docs/plans/994-canonical-audit-usage-investigation.md).

## Canonical Usage-to-Audit request investigation (#996)
An authorized Usage row can open Audit for its exact request ID. Preserve destination applied Audit principal/model/time/page-size restrictions only, discard unsubmitted destination edits and pagination, cancel departing CSV before navigation and issue a fresh authorized Audit read. Never copy Usage row principal or infer Audit permission from Usage visibility. Existing loading, empty, sanitized failure/retry, terminal401/403, disposal and retired-control rules apply. No visible audit is not proof of no decision or complete history. No new session or runtime activation.

## CSV delivery alert lifecycle (#998)
A new canonical Usage/Audit JSON read clears that tab browser delivery-failure alert immediately at loading. Refresh, submitted filters and tab re-entry are fresh reads; local draft edits/discard are not and retain the alert. This does not retry a download, change authorization, clear exported files or certify installed E2E. Denial/disposal still clear the shared authority and retained controls.

## Explicit pending CSV cancellation (#1000)
While preparing a canonical Usage/Audit CSV, Cancel CSV export aborts only that export and retires its completion. Preserve authorized JSON rows, pagination, applied scope and unapplied drafts. Cancellation is a neutral status, not an unavailable alert. Download again is explicit and freshly authorized; no automatic replay. Late success cannot save a file; late denial from the aborted request cannot terminate the current identity epoch. Current fresh401/403 still tears down both histories. Retired cancel buttons cannot affect subsequent exports or disposed mounts. An already downloaded file cannot be recalled. No new session/runtime/entry activation or installed acceptance.


## Explicit pending page cancellation (#1002)

While Usage or Audit JSON is loading, Cancel history request aborts that review’s pending transport, clears rows and pagination and shows neutral cancellation status. It preserves the attempted applied filters/cursor path for explicit Retry and preserves unapplied drafts without submitting them. No automatic read, export, download, permission grant or session change occurs. Retry reauthorizes the exact attempted page; previously visible rows are not restored as fresh authority. Ignored-abort success/401/403 is stale and cannot overwrite/revoke a newer read; current 401/403 remains terminal for the shared workspace. Cancellation is inert outside loading and after disposal, and retained controls cannot cancel a replacement request. Aborting a browser read does not guarantee that server-side work stopped.
