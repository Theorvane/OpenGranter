import { z } from 'zod';
import { createPostgresIdentitySnapshotStore } from '../identity/postgres-snapshots.ts';
import {
  createPostgresSsoHumanAuthenticator,
  SsoManagementUnauthenticated,
} from '../identity/postgres-sso-human-authentication.ts';
import type { VerifiedSsoIdentity } from '../identity/rfc9068-sso-access-tokens.ts';
import { evaluate } from '../policy/evaluate.ts';
import { type PolicyVersion, resolvePolicyAttachments } from '../policy/evaluate-attachments.ts';
import type { MigrationConnection, MigrationTransaction } from '../storage/postgres-migrations.ts';
import {
  attestOwnedConfiguration,
  generationNumber,
  InvalidOwnedConfiguration,
  type OwnedConfiguration,
  parseOwnedConfiguration,
  revisionNumber,
  validConfigurationId,
} from './owned-configuration.ts';

export type ConfigurationOperation = 'create' | 'read' | 'publish' | 'import';
interface Publication {
  readonly revision: number | null;
  readonly generation: number;
}
interface Provenance {
  readonly routeId: string;
  readonly version: string;
  readonly kind: 'managed' | 'delegated';
  readonly policyVersions: readonly PolicyVersion[];
}
export interface ConfigurationResult {
  readonly status: number;
  readonly body: {
    readonly error?: string;
    readonly revision?: number;
    readonly generation?: number;
    readonly publication?: Publication;
    readonly configuration?: OwnedConfiguration;
    readonly provenance?: Provenance | null;
  };
}
interface ExecuteInput {
  readonly operation: ConfigurationOperation;
  readonly accessToken?: string;
  readonly requestId: string;
  /** Invoked only after authentication and authorization. */
  readonly readInput: () => Promise<unknown>;
}
const readSchema = z.strictObject({ revision: revisionNumber.nullable() });
const publishSchema = z.strictObject({
  revision: revisionNumber,
  expectedRevision: revisionNumber.nullable(),
  expectedGeneration: generationNumber,
});
const createSchema = z.strictObject({ configuration: z.unknown() });
const importSchema = z.strictObject({
  configuration: z.unknown(),
  source: z.strictObject({ routeId: z.string(), version: z.string() }),
});
const provenanceSchema = z.strictObject({
  routeId: z.string(),
  version: z.string(),
  kind: z.enum(['managed', 'delegated']),
  policyVersions: z.array(z.strictObject({ id: z.string(), version: z.string() })).max(1024),
});

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Configuration store unavailable');
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 0): number {
  const parsed =
    typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < minimum)
    throw new Error('Configuration store unavailable');
  return parsed;
}
function failure(status: number, error: string): ConfigurationResult {
  return { status, body: { error } };
}

async function publication(tx: MigrationTransaction, lock = false): Promise<Publication> {
  const { rows } = await tx.query(
    `SELECT revision_id, generation FROM owned_configuration_publication WHERE singleton = true${lock ? ' FOR UPDATE' : ''}`,
    [],
  );
  if (rows.length !== 1) throw new Error('Configuration store unavailable');
  const row = object(rows[0]);
  const generation = integer(row.generation);
  if (generation > Number.MAX_SAFE_INTEGER - 1) throw new Error('Configuration store unavailable');
  return { revision: row.revision_id === null ? null : integer(row.revision_id, 1), generation };
}
async function revision(tx: MigrationTransaction, id: number) {
  const { rows } = await tx.query(
    'SELECT schema_version, configuration, provenance FROM owned_configuration_revisions WHERE revision_id=$1',
    [id],
  );
  if (rows.length === 0) return undefined;
  if (rows.length !== 1) throw new Error('Configuration store unavailable');
  const row = object(rows[0]);
  if (row.schema_version !== 1) throw new Error('Configuration store unavailable');
  // Stored JSON is untrusted too. Corruption must fail closed without body echo.
  try {
    return {
      configuration: parseOwnedConfiguration(row.configuration),
      provenance: row.provenance === null ? null : provenanceSchema.parse(row.provenance),
    };
  } catch {
    throw new Error('Configuration store unavailable');
  }
}

async function importProvenance(
  tx: MigrationTransaction,
  source: { routeId: string; version: string },
  configuration: OwnedConfiguration,
  policyVersions: readonly PolicyVersion[],
): Promise<Provenance> {
  if (!validConfigurationId(source.routeId) || !validConfigurationId(source.version))
    throw new InvalidOwnedConfiguration();
  const { rows } = await tx.query(
    'SELECT alias, kind, version, credential_ref, jev_credential_ref, jev_minimum_confidence, jev_send_prompt, candidates FROM catalog_routes WHERE route_id=$1 FOR SHARE',
    [source.routeId],
  );
  if (rows.length !== 1) throw new InvalidOwnedConfiguration();
  const row = object(rows[0]);
  const route = configuration.routes[0];
  if (
    configuration.routes.length !== 1 ||
    !route ||
    row.alias !== route.alias ||
    row.version !== source.version ||
    (row.kind !== 'managed' && row.kind !== 'delegated') ||
    row.jev_credential_ref !== null ||
    row.jev_minimum_confidence !== null ||
    row.jev_send_prompt !== null ||
    !Array.isArray(row.candidates) ||
    row.candidates.length !== route.candidates.length
  )
    throw new InvalidOwnedConfiguration();
  const oldCandidates = row.candidates.map((candidate: unknown) => {
    const parsed = z
      .strictObject({
        id: z.string(),
        kind: z.enum(['managed', 'delegated']),
        providerId: z.string(),
        upstreamModelId: z.string(),
      })
      .safeParse(candidate);
    if (!parsed.success || parsed.data.kind !== row.kind) throw new InvalidOwnedConfiguration();
    return parsed.data;
  });
  if (new Set(oldCandidates.map((candidate) => candidate.id)).size !== oldCandidates.length)
    throw new InvalidOwnedConfiguration();
  for (const candidate of route.candidates) {
    if (
      !oldCandidates.some(
        (old) =>
          old.id === candidate.id &&
          old.providerId === candidate.providerId &&
          old.upstreamModelId === candidate.upstreamModelId,
      )
    )
      throw new InvalidOwnedConfiguration();
    const provider = configuration.providers.find(
      (provider) => provider.id === candidate.transportProviderId,
    );
    if (!provider) throw new InvalidOwnedConfiguration();
    if (row.kind === 'delegated') {
      if (provider.kind !== 'openrouter' || row.credential_ref !== provider.credentialRef)
        throw new InvalidOwnedConfiguration();
    } else {
      if (provider.kind === 'openrouter' || candidate.transportProviderId !== candidate.providerId)
        throw new InvalidOwnedConfiguration();
      const direct = await tx.query(
        'SELECT kind, credential_ref, enabled FROM direct_provider_registrations WHERE provider_id=$1 FOR SHARE',
        [provider.id],
      );
      if (direct.rows.length === 0) throw new InvalidOwnedConfiguration();
      const registration = object(direct.rows[0]);
      if (
        direct.rows.length !== 1 ||
        registration.enabled !== true ||
        registration.kind !== provider.kind ||
        registration.credential_ref !== provider.credentialRef
      )
        throw new InvalidOwnedConfiguration();
    }
  }
  return { routeId: source.routeId, version: source.version, kind: row.kind, policyVersions };
}

/** Opt-in configuration only. Trusted deployment supplies SSO verification, registry and transaction port. */
export function createOwnedConfigurationService(ports: {
  readonly connection: MigrationConnection;
  readonly now: () => number;
  readonly verifyAccessToken: (token: string) => Promise<VerifiedSsoIdentity | undefined>;
  readonly loadRegistry: (tx: MigrationTransaction) => Promise<unknown>;
}) {
  return {
    async execute(request: ExecuteInput): Promise<ConfigurationResult> {
      const input = { ...request };
      if (
        !validConfigurationId(input.requestId) ||
        !['create', 'read', 'publish', 'import'].includes(input.operation)
      )
        return failure(400, 'invalid_request');
      try {
        return await ports.connection.transaction(async (tx) => {
          const now = ports.now();
          if (!Number.isSafeInteger(now) || now < 0)
            throw new Error('Configuration clock unavailable');
          let principalId: string | null = null;
          let policyVersions: readonly PolicyVersion[] = [];
          const audit = async (
            outcome: string,
            target: number | null = null,
            generation: number | null = null,
            registryVersion: string | null = null,
          ) => {
            const { rows } = await tx.query(
              `INSERT INTO owned_configuration_audit (occurred_at_ms, request_id, operation, outcome, principal_id, policy_versions, revision_id, generation, registry_version) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING event_id`,
              [
                now,
                input.requestId,
                input.operation,
                outcome,
                principalId,
                JSON.stringify(policyVersions),
                target,
                generation,
                registryVersion,
              ],
            );
            if (rows.length !== 1) throw new Error('Configuration audit unavailable');
            integer(object(rows[0]).event_id, 1);
          };
          const authenticate = createPostgresSsoHumanAuthenticator({
            client: tx,
            verifyAccessToken: ports.verifyAccessToken,
          });
          try {
            if (!input.accessToken) throw new SsoManagementUnauthenticated();
            principalId = await authenticate(input.accessToken);
          } catch (error) {
            const denied = error instanceof SsoManagementUnauthenticated;
            await audit(denied ? 'unauthenticated' : 'unavailable');
            return failure(
              denied ? 401 : 503,
              denied ? 'unauthorized' : 'configuration_unavailable',
            );
          }
          const snapshot = await createPostgresIdentitySnapshotStore(tx).loadSnapshot(principalId);
          const resolved = snapshot ? resolvePolicyAttachments(snapshot) : undefined;
          const active = snapshot?.principal.active === true && snapshot.principal.kind === 'human';
          policyVersions = resolved?.policyVersions ?? [];
          const actions =
            input.operation === 'import'
              ? ['Write', 'Import']
              : [
                  { create: 'Write', read: 'Read', publish: 'Publish', import: 'Import' }[
                    input.operation
                  ],
                ];
          if (
            !active ||
            !resolved ||
            actions.some(
              (action) =>
                evaluate({
                  principalActive: active,
                  statements: resolved.statements,
                  action: `routing:${action}Configuration`,
                  resource: 'routing-configuration:organization',
                }).effect !== 'Allow',
            )
          ) {
            await audit('denied');
            return failure(403, 'forbidden');
          }
          let payload: unknown;
          try {
            payload = await input.readInput();
          } catch {
            payload = undefined;
          }
          try {
            if (input.operation === 'read') {
              const parsed = readSchema.safeParse(payload);
              if (!parsed.success) throw new InvalidOwnedConfiguration();
              const current = await publication(tx);
              const target = parsed.data.revision;
              const saved = target === null ? undefined : await revision(tx, target);
              if (target !== null && !saved) {
                await audit('missing', target);
                return failure(404, 'not_found');
              }
              await audit('allowed', target, current.generation);
              return { status: 200, body: { publication: current, ...(saved ?? {}) } };
            }
            if (input.operation === 'publish') {
              const parsed = publishSchema.safeParse(payload);
              if (!parsed.success) throw new InvalidOwnedConfiguration();
              const { revision: target, expectedRevision, expectedGeneration } = parsed.data;
              const current = await publication(tx, true);
              if (
                current.revision !== expectedRevision ||
                current.generation !== expectedGeneration
              ) {
                await audit('conflict', target, current.generation);
                return failure(409, 'publication_conflict');
              }
              const saved = await revision(tx, target);
              if (!saved) {
                await audit('missing', target);
                return failure(404, 'not_found');
              }
              const registryVersion = attestOwnedConfiguration(
                saved.configuration,
                await ports.loadRegistry(tx),
              );
              if (current.generation >= Number.MAX_SAFE_INTEGER - 1)
                throw new Error('Publication generation exhausted');
              const { rows } = await tx.query(
                'UPDATE owned_configuration_publication SET revision_id=$1, generation=generation+1 WHERE singleton=true AND generation=$2 RETURNING generation',
                [target, current.generation],
              );
              if (rows.length !== 1) throw new Error('Publication store unavailable');
              if (integer(object(rows[0]).generation) !== current.generation + 1)
                throw new Error('Publication store unavailable');
              await audit('allowed', target, current.generation + 1, registryVersion);
              return {
                status: 200,
                body: { revision: target, generation: current.generation + 1 },
              };
            }
            const parsed = (input.operation === 'import' ? importSchema : createSchema).safeParse(
              payload,
            );
            if (!parsed.success) throw new InvalidOwnedConfiguration();
            const configuration = parseOwnedConfiguration(parsed.data.configuration);
            const registryVersion = attestOwnedConfiguration(
              configuration,
              await ports.loadRegistry(tx),
            );
            const imported =
              input.operation === 'import' ? importSchema.safeParse(payload) : undefined;
            const provenance = imported?.success
              ? await importProvenance(tx, imported.data.source, configuration, policyVersions)
              : null;
            const { rows } = await tx.query(
              'INSERT INTO owned_configuration_revisions (schema_version, configuration, provenance, registry_version, created_at_ms, principal_id, policy_versions) VALUES (1,$1::jsonb,$2::jsonb,$3,$4,$5,$6::jsonb) RETURNING revision_id',
              [
                JSON.stringify(configuration),
                provenance === null ? null : JSON.stringify(provenance),
                registryVersion,
                now,
                principalId,
                JSON.stringify(policyVersions),
              ],
            );
            if (rows.length !== 1) throw new Error('Configuration store unavailable');
            const target = integer(object(rows[0]).revision_id, 1);
            await audit('allowed', target, null, registryVersion);
            return { status: 201, body: { revision: target } };
          } catch (error) {
            if (!(error instanceof InvalidOwnedConfiguration)) throw error;
            await audit('invalid');
            return failure(400, 'invalid_request');
          }
        });
      } catch {
        return failure(503, 'configuration_unavailable');
      }
    },
  };
}
