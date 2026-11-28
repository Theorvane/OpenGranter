-- No default policy or production limits are provisioned by this migration.
CREATE TABLE reservation_principals (
  principal_id text PRIMARY KEY,
  version text NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  window_ms bigint NOT NULL CHECK (window_ms > 0),
  request_limit bigint NOT NULL CHECK (request_limit >= 0),
  budget numeric NOT NULL CHECK (budget >= 0),
  valid_until_ms bigint NOT NULL CHECK (valid_until_ms >= 0),
  blocked boolean NOT NULL DEFAULT false
);
CREATE TABLE routing_reservations (
  request_id text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES reservation_principals,
  window_start_ms bigint NOT NULL,
  currency text NOT NULL,
  window_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  owner_token text,
  binding jsonb NOT NULL,
  policy_version text NOT NULL,
  policy_snapshot jsonb NOT NULL
);
CREATE INDEX routing_reservations_principal_idx ON routing_reservations(principal_id, window_start_ms);
CREATE TABLE routing_reservation_attempts (
  request_id text NOT NULL REFERENCES routing_reservations,
  candidate_id text NOT NULL,
  liability numeric NOT NULL CHECK (liability >= 0),
  attempt_id text UNIQUE,
  started_at_ms bigint CHECK (started_at_ms >= 0),
  handed_off boolean NOT NULL DEFAULT false,
  allow_fallback boolean NOT NULL DEFAULT false,
  debit numeric CHECK (debit >= 0),
  evidence jsonb,
  PRIMARY KEY(request_id, candidate_id),
  CHECK (NOT handed_off OR attempt_id IS NOT NULL),
  CHECK ((attempt_id IS NULL) = (started_at_ms IS NULL))
);
