export interface SsoIdentityBindingSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class InvalidSsoIdentityBindingInput extends Error {
  constructor() {
    super('Invalid SSO identity binding input');
    this.name = 'InvalidSsoIdentityBindingInput';
  }
}

export class SsoIdentityBindingUnavailable extends Error {
  constructor() {
    super('SSO identity binding unavailable');
    this.name = 'SsoIdentityBindingUnavailable';
  }
}

const BINDING_SQL = `
  SELECT b.issuer, b.subject, p.principal_id, p.kind, p.active
  FROM iam_sso_identity_bindings b
  JOIN iam_principals p ON p.principal_id = b.principal_id
  WHERE b.issuer = $1 AND b.subject = $2`;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new SsoIdentityBindingUnavailable();
  return value as Record<string, unknown>;
}

function opaqueString(value: unknown, maximumLength: number): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes('\0')
  )
    return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

/** Resolve an already verified SSO identity; this reader does not authenticate or authorize. */
export function createPostgresSsoIdentityBindingReader(client: SsoIdentityBindingSqlClient): {
  readonly resolveHumanPrincipal: (input: {
    readonly issuer: string;
    readonly subject: string;
  }) => Promise<string | undefined>;
} {
  return {
    async resolveHumanPrincipal(input) {
      let issuer: string;
      let subject: string;
      try {
        const identity = record(input, ['issuer', 'subject']);
        const rawIssuer = identity.issuer;
        const rawSubject = identity.subject;
        if (!opaqueString(rawIssuer, 2048) || !opaqueString(rawSubject, 256))
          throw new InvalidSsoIdentityBindingInput();
        issuer = rawIssuer;
        subject = rawSubject;
      } catch {
        throw new InvalidSsoIdentityBindingInput();
      }
      try {
        const result = record(await client.query(BINDING_SQL, Object.freeze([issuer, subject])), [
          'rows',
        ]);
        const rows = result.rows;
        if (!Array.isArray(rows)) throw new SsoIdentityBindingUnavailable();
        const length = rows.length;
        if (length === 0) return undefined;
        if (length !== 1 || !Object.hasOwn(rows, 0)) throw new SsoIdentityBindingUnavailable();
        const row = record(rows[0], ['issuer', 'subject', 'principal_id', 'kind', 'active']);
        const rowIssuer = row.issuer;
        const rowSubject = row.subject;
        const principalId = row.principal_id;
        const kind = row.kind;
        const active = row.active;
        if (
          rowIssuer !== issuer ||
          rowSubject !== subject ||
          !opaqueString(principalId, 256) ||
          (kind !== 'human' && kind !== 'service') ||
          typeof active !== 'boolean'
        )
          throw new SsoIdentityBindingUnavailable();
        return kind === 'human' && active ? principalId : undefined;
      } catch {
        throw new SsoIdentityBindingUnavailable();
      }
    },
  };
}
