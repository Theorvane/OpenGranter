CREATE TABLE IF NOT EXISTS gateway_audit_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
  kind text NOT NULL,
  request_id text NOT NULL,
  principal_id text,
  credential_id text,
  policy_versions jsonb,
  details jsonb NOT NULL,
  CONSTRAINT gateway_audit_attribution CHECK (
    (principal_id IS NULL AND credential_id IS NULL AND policy_versions IS NULL)
    OR (principal_id IS NOT NULL AND credential_id IS NOT NULL AND policy_versions IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS gateway_audit_request_idx
  ON gateway_audit_events (request_id, event_id);

CREATE INDEX IF NOT EXISTS gateway_audit_principal_time_idx
  ON gateway_audit_events (principal_id, occurred_at_ms DESC, event_id DESC);
