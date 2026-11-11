CREATE TABLE sso_audit_history_access_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  outcome text NOT NULL CHECK (outcome IN ('ready', 'forbidden', 'invalid_query', 'unauthenticated', 'unavailable')),
  record_count bigint NOT NULL CHECK (record_count >= 0),
  principal_id text CHECK (length(principal_id) BETWEEN 1 AND 256),
  policy_versions jsonb,
  target_principal_id text CHECK (length(target_principal_id) BETWEEN 1 AND 256),
  CHECK ((principal_id IS NULL AND policy_versions IS NULL AND outcome IN ('unauthenticated', 'unavailable'))
    OR (principal_id IS NOT NULL AND policy_versions IS NOT NULL AND jsonb_typeof(policy_versions) = 'array' AND outcome <> 'unauthenticated')),
  CHECK (outcome = 'ready' OR record_count = 0),
  CHECK (target_principal_id IS NULL OR principal_id IS NOT NULL),
  CHECK (outcome NOT IN ('ready', 'forbidden') OR target_principal_id IS NOT NULL),
  CHECK (outcome NOT IN ('invalid_query', 'unauthenticated') OR target_principal_id IS NULL)
);
CREATE INDEX sso_audit_history_access_request_idx ON sso_audit_history_access_events (request_id, event_id);
CREATE INDEX sso_audit_history_access_principal_time_idx ON sso_audit_history_access_events (principal_id, occurred_at_ms DESC, event_id DESC);
