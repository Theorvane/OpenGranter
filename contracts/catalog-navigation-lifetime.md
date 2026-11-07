# Catalog navigation lifetime

Existing SSO catalog list/detail/refresh/recovery controls are valid only for their rendered snapshot. Calling a detached control after another navigation, while a read is pending, after authority replacement, clearing, disposal or expiry must not send a request or cancel current work. The authority snapshot check must evaluate expiry even if timers did not fire. Current controls still perform fresh server-authenticated, authorized and audited reads. This is UI lifecycle isolation, not a session or an IAM grant. No session/API/SQL/runtime activation is introduced.

## Explicit unavailable recovery
Unavailable list/detail reads offer Retry model lookup. An explicit retry repeats the last selected target with one fresh existing server-authenticated, authorized and audited GET, without an intermediate list read. No automatic retry, retained response body or retry for missing/401/403 is permitted. Retry belongs to its render snapshot: double click, navigation, renewal, clear, suspended-timer expiry and disposal cannot send an extra request. Back to models still performs an explicit fresh list read.
