CREATE TABLE sso_catalog_audit_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  operation text NOT NULL CHECK (operation IN ('list', 'detail')),
  outcome text NOT NULL CHECK (outcome IN ('ready', 'missing', 'unauthenticated', 'unavailable')),
  model_count bigint NOT NULL CHECK (model_count >= 0),
  principal_id text CHECK (length(principal_id) BETWEEN 1 AND 256),
  policy_versions jsonb,
  CHECK ((principal_id IS NULL AND policy_versions IS NULL AND outcome IN ('unauthenticated', 'unavailable'))
    OR (principal_id IS NOT NULL AND policy_versions IS NOT NULL AND jsonb_typeof(policy_versions) = 'array' AND outcome <> 'unauthenticated')),
  CHECK (outcome = 'ready' OR model_count = 0),
  CHECK (outcome <> 'missing' OR operation = 'detail'),
  CHECK (operation <> 'detail' OR outcome <> 'ready' OR model_count = 1)
);
CREATE INDEX sso_catalog_audit_request_idx ON sso_catalog_audit_events (request_id, event_id);
CREATE INDEX sso_catalog_audit_principal_time_idx ON sso_catalog_audit_events (principal_id, occurred_at_ms DESC, event_id DESC);
