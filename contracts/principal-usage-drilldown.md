# Principal usage drilldown (#642)

A row exposes Filter usage for principal followed by its exact identifier as text. Activation requests the existing usage reader with that principal plus submitted model/time/page-size filters. It discards paging history, cursor, unsubmitted drafts and CSV continuation; empty/error/loading states remain the existing reader states. Current server IAM and mandatory audit remain authoritative; no directory access, new endpoint, permission or session activation is implied. Detached, renewed, expired, denied and disposed controls cannot read; late results cannot redisplay private rows. Source/artifact event tests and signed-SSO HTTP with migrated PGlite are not native browser or installed PostgreSQL evidence.

Explicit principal selection retains the existing ReadAll semantics even for the current principal: ReadSelf alone may produce Access denied. The action never silently retries without the principal filter.
