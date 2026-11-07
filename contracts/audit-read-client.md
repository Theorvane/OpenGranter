# Audit read client contract (#782)

Only an explicit authorized request port can read GET /v1/audit. Cookies are
omitted, redirects rejected and request cache disabled. The module neither
obtains bearer tokens nor creates an SSO/session bridge. A ready page contains
only server-projected audit metadata, validated descending IDs and one principal.
Requested principal/model/time filters must match returned events. Continuation
is transported exactly and must agree with the final event. Empty pages are
ready, not errors. Denials and private failure bodies are never exposed.
Invalidation and superseding reads discard stale completion; bounded reads and
a deadline prevent unbounded consumption. No retries or browser persistence.
The server remains responsible for fresh authentication, IAM and mandatory audit.
This does not activate an Audit screen or complete #642 export/session acceptance.
