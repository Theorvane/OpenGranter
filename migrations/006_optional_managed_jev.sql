ALTER TABLE catalog_routes
  DROP CONSTRAINT catalog_routes_check;

ALTER TABLE catalog_routes
  ADD CONSTRAINT catalog_route_settings_complete CHECK (
    (kind = 'managed' AND credential_ref IS NULL AND (
      (jev_credential_ref IS NULL
        AND jev_minimum_confidence IS NULL
        AND jev_send_prompt IS NULL)
      OR
      (jev_credential_ref IS NOT NULL
        AND jev_minimum_confidence IS NOT NULL
        AND jev_minimum_confidence BETWEEN 0 AND 1
        AND jev_send_prompt IS NOT NULL)
    ))
    OR
    (kind = 'delegated' AND credential_ref IS NOT NULL
      AND jev_credential_ref IS NULL
      AND jev_minimum_confidence IS NULL
      AND jev_send_prompt IS NULL)
  );
