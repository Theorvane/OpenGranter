-- Review candidate only: deliberately NOT part of the active migration manifest.
-- Promote to a numbered migration only after schema/ownership review.
CREATE TABLE sso_usage_audit_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  principal_id text CHECK (length(principal_id) BETWEEN 1 AND 256),
  policy_versions jsonb,
  target_principal_id text CHECK (length(target_principal_id) BETWEEN 1 AND 256),
  mode text CHECK (mode IN ('self', 'all')),
  outcome text NOT NULL CHECK (outcome IN ('ready', 'forbidden', 'invalid_query', 'unauthenticated', 'unavailable')),
  record_count bigint NOT NULL CHECK (record_count BETWEEN 0 AND 100),
  CHECK ((principal_id IS NULL AND policy_versions IS NULL AND mode IS NULL AND outcome IN ('unauthenticated', 'unavailable'))
    OR (principal_id IS NOT NULL AND policy_versions IS NOT NULL AND jsonb_typeof(policy_versions) = 'array' AND outcome <> 'unauthenticated')),
  CHECK ((mode IS NULL) = (target_principal_id IS NULL)),
  CHECK (mode IS DISTINCT FROM 'self' OR (principal_id IS NOT NULL AND target_principal_id = principal_id)),
  CHECK (outcome NOT IN ('ready', 'forbidden') OR mode IS NOT NULL),
  CHECK (outcome <> 'invalid_query' OR mode IS NULL),
  CHECK (outcome = 'ready' OR record_count = 0)
);
CREATE INDEX sso_usage_audit_request_idx ON sso_usage_audit_events (request_id, event_id);
CREATE INDEX sso_usage_audit_principal_time_idx ON sso_usage_audit_events (principal_id, occurred_at_ms DESC, event_id DESC);
