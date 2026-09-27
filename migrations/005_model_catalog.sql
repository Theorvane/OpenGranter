CREATE TABLE IF NOT EXISTS catalog_models (
  alias text PRIMARY KEY,
  created_at_seconds bigint NOT NULL CHECK (created_at_seconds >= 0),
  enabled boolean NOT NULL,
  active_route_id text
);

CREATE TABLE IF NOT EXISTS catalog_routes (
  route_id text PRIMARY KEY,
  alias text NOT NULL REFERENCES catalog_models (alias),
  kind text NOT NULL CHECK (kind IN ('managed', 'delegated')),
  version text NOT NULL,
  credential_ref text,
  jev_credential_ref text,
  jev_minimum_confidence double precision,
  jev_send_prompt boolean,
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array'),
  UNIQUE (alias, route_id),
  CHECK (
    (kind = 'managed' AND credential_ref IS NULL
      AND jev_credential_ref IS NOT NULL
      AND jev_minimum_confidence BETWEEN 0 AND 1
      AND jev_send_prompt IS NOT NULL)
    OR
    (kind = 'delegated' AND credential_ref IS NOT NULL
      AND jev_credential_ref IS NULL
      AND jev_minimum_confidence IS NULL
      AND jev_send_prompt IS NULL)
  )
);

ALTER TABLE catalog_models
  ADD CONSTRAINT catalog_active_route_same_alias
  FOREIGN KEY (alias, active_route_id)
  REFERENCES catalog_routes (alias, route_id);
