CREATE TABLE IF NOT EXISTS openrouter_provider_mappings (
  provider_id text NOT NULL CHECK (char_length(provider_id) BETWEEN 1 AND 256),
  upstream_model_id text NOT NULL CHECK (char_length(upstream_model_id) BETWEEN 1 AND 256),
  provider_slug text NOT NULL CHECK (char_length(provider_slug) BETWEEN 1 AND 256),
  enabled boolean NOT NULL,
  verified boolean NOT NULL,
  PRIMARY KEY (provider_id, upstream_model_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS openrouter_active_verified_destination
  ON openrouter_provider_mappings (upstream_model_id, provider_slug)
  WHERE enabled AND verified;
