CREATE TABLE token_management_decisions (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
  operation text NOT NULL CHECK (operation IN ('issue', 'revoke')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 256),
  target_principal_id text CHECK (length(target_principal_id) BETWEEN 1 AND 256),
  credential_id text CHECK (length(credential_id) BETWEEN 1 AND 256),
  policy_versions jsonb NOT NULL CHECK (jsonb_typeof(policy_versions) = 'array'),
  CHECK (outcome = 'denied' OR target_principal_id IS NOT NULL),
  CHECK ((operation = 'issue' AND credential_id IS NULL) OR
         (operation = 'revoke' AND credential_id IS NOT NULL))
);
