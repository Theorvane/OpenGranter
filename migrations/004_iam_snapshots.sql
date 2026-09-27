CREATE TABLE IF NOT EXISTS iam_principals (
  principal_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('human', 'service')),
  active boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS iam_roles (
  role_id text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS iam_policies (
  policy_id text PRIMARY KEY,
  version text NOT NULL,
  statements jsonb NOT NULL CHECK (jsonb_typeof(statements) = 'array')
);

CREATE TABLE IF NOT EXISTS iam_principal_policies (
  principal_id text NOT NULL REFERENCES iam_principals (principal_id),
  policy_id text NOT NULL REFERENCES iam_policies (policy_id),
  PRIMARY KEY (principal_id, policy_id)
);

CREATE TABLE IF NOT EXISTS iam_principal_roles (
  principal_id text NOT NULL REFERENCES iam_principals (principal_id),
  role_id text NOT NULL REFERENCES iam_roles (role_id),
  PRIMARY KEY (principal_id, role_id)
);

CREATE TABLE IF NOT EXISTS iam_role_policies (
  role_id text NOT NULL REFERENCES iam_roles (role_id),
  policy_id text NOT NULL REFERENCES iam_policies (policy_id),
  PRIMARY KEY (role_id, policy_id)
);
