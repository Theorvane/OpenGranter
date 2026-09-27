CREATE TABLE IF NOT EXISTS usage_records (
  attempt_id text PRIMARY KEY,
  request_id text NOT NULL,
  principal_id text NOT NULL,
  occurred_at_ms bigint NOT NULL,
  record jsonb NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_records_record_object CHECK (jsonb_typeof(record) = 'object'),
  CONSTRAINT usage_records_attempt_matches CHECK (record->>'attemptId' = attempt_id),
  CONSTRAINT usage_records_nonnegative_time CHECK (occurred_at_ms >= 0)
);

CREATE INDEX IF NOT EXISTS usage_records_principal_time_idx
  ON usage_records (principal_id, occurred_at_ms DESC, attempt_id DESC);
