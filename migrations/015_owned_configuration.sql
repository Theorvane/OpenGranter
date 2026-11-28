-- Additive opt-in storage. No legacy catalog/IAM/discovery pointer is changed.
CREATE TABLE owned_configuration_revisions (
  revision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY CHECK (revision_id BETWEEN 1 AND 9007199254740991),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  provenance jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  registry_version text NOT NULL,
  created_at_ms bigint NOT NULL CHECK (created_at_ms BETWEEN 0 AND 9007199254740991),
  principal_id text NOT NULL,
  policy_versions jsonb NOT NULL CHECK (jsonb_typeof(policy_versions) = 'array')
);
CREATE TABLE owned_configuration_publication (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision_id bigint REFERENCES owned_configuration_revisions(revision_id),
  generation bigint NOT NULL CHECK (generation BETWEEN 0 AND 9007199254740990)
);
INSERT INTO owned_configuration_publication VALUES (true, NULL, 0);
CREATE TABLE owned_configuration_audit (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms BETWEEN 0 AND 9007199254740991),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  operation text NOT NULL CHECK (operation IN ('create', 'read', 'publish', 'import')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'unauthenticated', 'unavailable', 'invalid', 'conflict', 'missing')),
  principal_id text,
  policy_versions jsonb NOT NULL CHECK (jsonb_typeof(policy_versions) = 'array'),
  revision_id bigint,
  generation bigint,
  registry_version text,
  CHECK (principal_id IS NOT NULL OR outcome IN ('unauthenticated', 'unavailable'))
);
CREATE INDEX owned_configuration_audit_request ON owned_configuration_audit(request_id, event_id);
