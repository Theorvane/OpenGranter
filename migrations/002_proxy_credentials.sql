CREATE TABLE IF NOT EXISTS proxy_credentials (
  credential_id text PRIMARY KEY,
  principal_id text NOT NULL,
  token_digest text NOT NULL,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  revoked_at_ms bigint,
  CONSTRAINT proxy_credentials_digest CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT proxy_credentials_expiry CHECK (expires_at_ms > created_at_ms),
  CONSTRAINT proxy_credentials_revoked_time CHECK (
    revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms
  )
);

CREATE INDEX IF NOT EXISTS proxy_credentials_principal_idx
  ON proxy_credentials (principal_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS proxy_credential_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credential_id text NOT NULL REFERENCES proxy_credentials (credential_id),
  principal_id text NOT NULL,
  actor_id text NOT NULL,
  request_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('issued', 'revoked')),
  occurred_at_ms bigint NOT NULL,
  UNIQUE (credential_id, action)
);
