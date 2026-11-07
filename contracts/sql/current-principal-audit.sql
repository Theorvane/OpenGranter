CREATE TABLE sso_current_principal_audit_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
 request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
 outcome text NOT NULL CHECK (outcome IN ('ready', 'unauthenticated', 'unavailable')),
 principal_id text CHECK (length(principal_id) BETWEEN 1 AND 256),
 CHECK ((outcome = 'ready' AND principal_id IS NOT NULL) OR (outcome <> 'ready' AND principal_id IS NULL))
);
CREATE INDEX sso_current_principal_audit_request_idx ON sso_current_principal_audit_events (request_id, event_id);
