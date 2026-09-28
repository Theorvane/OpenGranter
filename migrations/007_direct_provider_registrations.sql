CREATE TABLE IF NOT EXISTS direct_provider_registrations (
  provider_id text PRIMARY KEY CHECK (
    char_length(provider_id) BETWEEN 1 AND 256
    AND provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$'
  ),
  kind text NOT NULL CHECK (kind IN ('openai', 'anthropic', 'google')),
  credential_ref text NOT NULL CHECK (
    char_length(credential_ref) BETWEEN 1 AND 1024
    AND credential_ref !~ '[[:space:][:cntrl:]]'
  ),
  enabled boolean NOT NULL,
  max_output_tokens bigint CHECK (
    max_output_tokens > 0 AND max_output_tokens <= 9007199254740991
  ),
  CHECK (kind <> 'anthropic' OR max_output_tokens IS NOT NULL)
);
