# Model detail to usage drilldown

The existing trusted SSO workspace may expose a model-detail action to open the existing usage app. It passes the exact published alias as the initial model filter; it does not map upstream models, set a principal, carry old cursors or elevate permissions. The usage client validates and URL-encodes the filter through its existing contract. Pagination, refresh and CSV use the same selected filter. Ordinary navigation and new grants reset it.

Catalog visibility is not usage:ReadSelf or usage:ReadAll. Each usage read/export still authenticates and authorizes server-side and awaits required audit. A fresh 401/403 clears the workspace; no fallback or cached rows are exposed. Detached detail actions must not dispatch after a changed snapshot, renewal, expiry, pagehide, clear or disposal, even if timers are suspended.

This is source-only composition of existing views/APIs. No browser credential acquisition, session, public entry, listener, runtime registration, DDL or migration changes are included. Structural DOM plus signed-SSO loopback HTTP/embedded SQL tests do not certify native browser, installed PostgreSQL/IdP or live deployment.
