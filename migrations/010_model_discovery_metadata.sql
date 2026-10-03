ALTER TABLE catalog_models
  ADD COLUMN openrouter_metadata jsonb,
  ADD CONSTRAINT catalog_openrouter_metadata_object CHECK (
    openrouter_metadata IS NULL OR (
      jsonb_typeof(openrouter_metadata) = 'object'
      AND octet_length(openrouter_metadata::text) <= 65536
    )
  );
