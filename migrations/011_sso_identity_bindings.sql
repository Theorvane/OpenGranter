-- Exact pre-registered SSO identities; authentication and audited provisioning are separate.
CREATE TABLE iam_sso_identity_bindings (
  issuer text COLLATE "C" NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 2048),
  subject text COLLATE "C" NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 256),
  principal_id text NOT NULL REFERENCES iam_principals(principal_id),
  PRIMARY KEY (issuer, subject)
);
