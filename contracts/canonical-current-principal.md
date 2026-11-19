# Canonical Account identity read

GET /management/v1/me returns exactly {"principalId":"<current active human>"}. GET /management/v1/principal returns {"id":"<current active human>","kind":"human"}. Require registered-key RFC9068 bearer verification and a fresh exact active human binding for every request. No cookie authentication, session acquisition, IAM grant, cross-principal lookup or organization directory.

Mandatory dedicated SQL audit must complete with one valid positive event_id before identity release. Authentication failures are anonymous and audited; audit failure suppresses identity. Canonical factory accepts one SQL client only, not an audit callback. Caller owns committed/autocommit SQL, lifecycle and explicit installation of contracts/sql/current-principal-audit.sql; this change does not install it or alter migrations. Bodyless queryless GET only; 401/503/400 safe errors and no-store/nosniff. Unknown path/method remains 404 without private work.

See [numbered plan](../docs/plans/639-canonical-current-principal.md).
