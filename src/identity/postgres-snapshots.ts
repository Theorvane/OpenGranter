import type { IdentityAttachmentSnapshot } from '../gateway/attachment-authenticator.ts';
import type { Statement } from '../policy/evaluate.ts';
import {
  type PrincipalSnapshot,
  type RoleSnapshot,
  resolvePolicyAttachments,
  type VersionedPolicy,
} from '../policy/evaluate-attachments.ts';

export interface IdentitySnapshotSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class IdentitySnapshotUnavailable extends Error {
  constructor() {
    super('Identity attachment snapshot unavailable');
    this.name = 'IdentitySnapshotUnavailable';
  }
}

const SNAPSHOT_SQL = `
  SELECT jsonb_build_object(
    'principal', jsonb_build_object(
      'id', p.principal_id,
      'kind', p.kind,
      'active', p.active,
      'directPolicyIds', COALESCE((
        SELECT jsonb_agg(pp.policy_id ORDER BY pp.policy_id)
        FROM iam_principal_policies pp WHERE pp.principal_id = p.principal_id
      ), '[]'::jsonb),
      'roleIds', COALESCE((
        SELECT jsonb_agg(pr.role_id ORDER BY pr.role_id)
        FROM iam_principal_roles pr WHERE pr.principal_id = p.principal_id
      ), '[]'::jsonb)
    ),
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.role_id,
        'policyIds', COALESCE((
          SELECT jsonb_agg(rp.policy_id ORDER BY rp.policy_id)
          FROM iam_role_policies rp WHERE rp.role_id = r.role_id
        ), '[]'::jsonb)
      ) ORDER BY r.role_id)
      FROM iam_principal_roles pr
      JOIN iam_roles r ON r.role_id = pr.role_id
      WHERE pr.principal_id = p.principal_id
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pol.policy_id,
        'version', pol.version,
        'statements', pol.statements
      ) ORDER BY pol.policy_id)
      FROM iam_policies pol
      WHERE pol.policy_id IN (
        SELECT pp.policy_id FROM iam_principal_policies pp
        WHERE pp.principal_id = p.principal_id
        UNION
        SELECT rp.policy_id FROM iam_role_policies rp
        JOIN iam_principal_roles pr ON pr.role_id = rp.role_id
        WHERE pr.principal_id = p.principal_id
      )
    ), '[]'::jsonb)
  ) AS snapshot
  FROM iam_principals p
  WHERE p.principal_id = $1`;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IdentitySnapshotUnavailable();
  }
  return value as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new IdentitySnapshotUnavailable();
  }
  return value;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1024) throw new IdentitySnapshotUnavailable();
  const values = value.map(id);
  if (new Set(values).size !== values.length) throw new IdentitySnapshotUnavailable();
  return values;
}

function patterns(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1024) throw new IdentitySnapshotUnavailable();
  return value.map((pattern: unknown) => {
    if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 512) {
      throw new IdentitySnapshotUnavailable();
    }
    return pattern;
  });
}

function statements(value: unknown): Statement[] {
  if (!Array.isArray(value) || value.length > 1024) throw new IdentitySnapshotUnavailable();
  return value.map((entry: unknown) => {
    const statement = record(entry);
    if (statement.effect !== 'Allow' && statement.effect !== 'Deny') {
      throw new IdentitySnapshotUnavailable();
    }
    return {
      effect: statement.effect,
      actions: patterns(statement.actions),
      resources: patterns(statement.resources),
    };
  });
}

function parseSnapshot(value: unknown, principalId: string): IdentityAttachmentSnapshot {
  const snapshot = record(value);
  const rawPrincipal = record(snapshot.principal);
  if (
    rawPrincipal.id !== principalId ||
    (rawPrincipal.kind !== 'human' && rawPrincipal.kind !== 'service') ||
    typeof rawPrincipal.active !== 'boolean'
  ) {
    throw new IdentitySnapshotUnavailable();
  }
  const principal: PrincipalSnapshot = {
    id: id(rawPrincipal.id),
    kind: rawPrincipal.kind,
    active: rawPrincipal.active,
    directPolicyIds: ids(rawPrincipal.directPolicyIds),
    roleIds: ids(rawPrincipal.roleIds),
  };
  if (!Array.isArray(snapshot.roles) || snapshot.roles.length > 1024) {
    throw new IdentitySnapshotUnavailable();
  }
  const roles: RoleSnapshot[] = snapshot.roles.map((value: unknown) => {
    const role = record(value);
    return { id: id(role.id), policyIds: ids(role.policyIds) };
  });
  if (!Array.isArray(snapshot.policies) || snapshot.policies.length > 1024) {
    throw new IdentitySnapshotUnavailable();
  }
  const policies: VersionedPolicy[] = snapshot.policies.map((value: unknown) => {
    const policy = record(value);
    return {
      id: id(policy.id),
      version: id(policy.version),
      statements: statements(policy.statements),
    };
  });
  if (
    new Set(roles.map((role) => role.id)).size !== roles.length ||
    new Set(policies.map((policy) => policy.id)).size !== policies.length
  ) {
    throw new IdentitySnapshotUnavailable();
  }
  const result = { principal, roles, policies };
  if (principal.active && !resolvePolicyAttachments(result)) {
    throw new IdentitySnapshotUnavailable();
  }
  return result;
}

/** Load one consistent principal/role/policy view using a single SQL statement. */
export function createPostgresIdentitySnapshotStore(client: IdentitySnapshotSqlClient): {
  readonly loadSnapshot: (principalId: string) => Promise<IdentityAttachmentSnapshot | undefined>;
} {
  return {
    async loadSnapshot(principalId) {
      const targetId = id(principalId);
      try {
        const result = await client.query(SNAPSHOT_SQL, [targetId]);
        if (result.rows.length === 0) return undefined;
        if (result.rows.length !== 1) throw new IdentitySnapshotUnavailable();
        const row = record(result.rows[0]);
        return parseSnapshot(row.snapshot, targetId);
      } catch {
        throw new IdentitySnapshotUnavailable();
      }
    },
  };
}
