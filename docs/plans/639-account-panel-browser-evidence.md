# Account panel local browser evidence — 2026-11-16

Scope: issue #639; display-only consumer of the canonical Account API. No frontend shell activation or session authority.

The local harness built src/management/current-principal-panel.ts through buildManagementBrowser, served its module to the real browser and forwarded only its fixed Account read to the owned Node HTTP runtime. Authentication was a server-side synthetic test JWT. The runtime used migrated embedded PostgreSQL plus the explicit current-principal audit SQL. No bearer value entered browser source, storage or page markup. The harness is local verification infrastructure, not a product login or deployment.

Observed using browser_navigate/browser_snapshot/browser_act at http://127.0.0.1:18835:

1. Initial render: Account, Principal ID account-human, Principal kind human, Refresh account.
2. Clicking Refresh account immediately replaced identity with Loading account…; a later snapshot returned the same identity.
3. Clicking the harness-only Deactivate synthetic identity updated the embedded IAM row. Clicking Refresh account immediately removed the identity and showed Loading account….
4. The next snapshot showed Sign in required. No Account retry/refresh control or identity remained. The deactivation/disposal controls belonged only to the local harness.

Unit and actual HTTP tests additionally cover sanitized errors, 403, audit outage/recovery, ignored cancellation, disposal and stale controls. They are separate from this real browser observation. Tests and browser evidence do NOT certify company IdP login/logout, TLS, installed PostgreSQL, external user access or real provider calls.

## Reviewed-main integration browser checkpoint — 2026-11-18 05:30 KST

Rebuilt the same local harness from the integrated main canonical transport and panel. Native browser at http://127.0.0.1:18835 displayed exact account-human/human and Refresh account. Refresh returned the same identity; this run did not separately capture the transient loading frame. Harness-only deactivation followed by Refresh removed all Account identity/actions and showed Sign in required. Dispose removed the entire Account section. The two remaining buttons belonged only to the synthetic harness. Binding-removal/rebinding to replacement-human and exact ordered durable audit outcomes were additionally verified in the actual HTTP DOM test, not this browser sequence. This URL is loopback-only and is not a user deployment URL. Existing non-acceptance limits still apply.
