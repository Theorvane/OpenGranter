import type { RouteCandidate, RouteKind } from '../routing/authorize-candidates.ts';
import type { DelegatedChatRoute, ManagedChatRoute, PublishedModel } from './chat-handler.ts';
import { snapshotOpenRouterMetadata } from './model-discovery-metadata.ts';

export interface ModelCatalogSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class ModelCatalogUnavailable extends Error {
  constructor() {
    super('Model catalog unavailable');
    this.name = 'ModelCatalogUnavailable';
  }
}

const SELECT = `SELECT m.alias, m.created_at_seconds::text AS created_at_seconds,
  m.enabled, m.openrouter_metadata, m.active_route_id, r.route_id, r.kind, r.version,
  r.credential_ref, r.jev_credential_ref, r.jev_minimum_confidence,
  r.jev_send_prompt, r.candidates
  FROM catalog_models m
  LEFT JOIN catalog_routes r ON r.alias = m.alias AND r.route_id = m.active_route_id`;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelCatalogUnavailable();
  }
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(value)
  ) {
    throw new ModelCatalogUnavailable();
  }
  return value;
}

function candidates(value: unknown, kind: RouteKind): RouteCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1024) {
    throw new ModelCatalogUnavailable();
  }
  const ids = new Set<string>();
  return value.map((input: unknown) => {
    const candidate = record(input);
    const id = identifier(candidate.id);
    if (candidate.kind !== kind || ids.has(id)) throw new ModelCatalogUnavailable();
    ids.add(id);
    return {
      id,
      kind,
      upstreamModelId: identifier(candidate.upstreamModelId),
      providerId: identifier(candidate.providerId),
    };
  });
}

function parseRow(value: unknown): {
  model: PublishedModel;
  route: ManagedChatRoute | DelegatedChatRoute | undefined;
} {
  const row = record(value);
  const alias = identifier(row.alias);
  if (
    typeof row.created_at_seconds !== 'string' ||
    !/^(?:0|[1-9][0-9]*)$/u.test(row.created_at_seconds)
  ) {
    throw new ModelCatalogUnavailable();
  }
  const created = Number(row.created_at_seconds);
  const metadata =
    row.openrouter_metadata === null || row.openrouter_metadata === undefined
      ? {}
      : { openRouterMetadata: snapshotOpenRouterMetadata(row.openrouter_metadata) };
  if (!Number.isSafeInteger(created) || typeof row.enabled !== 'boolean') {
    throw new ModelCatalogUnavailable();
  }
  if (row.active_route_id === null) {
    if (row.enabled || row.route_id !== null) throw new ModelCatalogUnavailable();
    return { model: { alias, created, enabled: false, routes: [], ...metadata }, route: undefined };
  }
  const routeId = identifier(row.active_route_id);
  if (row.route_id !== routeId) throw new ModelCatalogUnavailable();
  const version = identifier(row.version);
  if (row.kind !== 'managed' && row.kind !== 'delegated') throw new ModelCatalogUnavailable();
  const selectedCandidates = candidates(row.candidates, row.kind);
  let route: ManagedChatRoute | DelegatedChatRoute;
  if (row.kind === 'delegated') {
    if (
      row.jev_credential_ref !== null ||
      row.jev_minimum_confidence !== null ||
      row.jev_send_prompt !== null
    )
      throw new ModelCatalogUnavailable();
    route = {
      kind: 'delegated',
      version,
      credentialRef: identifier(row.credential_ref),
      candidates: selectedCandidates,
    };
  } else {
    if (row.credential_ref !== null) throw new ModelCatalogUnavailable();
    const noJev =
      row.jev_credential_ref === null &&
      row.jev_minimum_confidence === null &&
      row.jev_send_prompt === null;
    if (noJev) {
      route = { kind: 'managed', version, candidates: selectedCandidates };
    } else {
      if (
        typeof row.jev_minimum_confidence !== 'number' ||
        !Number.isFinite(row.jev_minimum_confidence) ||
        row.jev_minimum_confidence < 0 ||
        row.jev_minimum_confidence > 1 ||
        typeof row.jev_send_prompt !== 'boolean'
      ) {
        throw new ModelCatalogUnavailable();
      }
      route = {
        kind: 'managed',
        version,
        candidates: selectedCandidates,
        jev: {
          credentialRef: identifier(row.jev_credential_ref),
          minimumConfidence: row.jev_minimum_confidence,
          sendPrompt: row.jev_send_prompt,
        },
      };
    }
  }
  return {
    model: {
      ...metadata,
      alias,
      created,
      enabled: row.enabled,
      routes: [{ kind: row.kind, candidates: selectedCandidates }],
    },
    route: row.enabled ? route : undefined,
  };
}

/** Supply the gateway's trusted publication and route ports from PostgreSQL. */
export function createPostgresModelCatalogReader(client: ModelCatalogSqlClient): {
  readonly listPublishedModels: () => Promise<readonly PublishedModel[]>;
  readonly resolveRoute: (
    alias: string,
  ) => Promise<ManagedChatRoute | DelegatedChatRoute | undefined>;
} {
  return {
    async listPublishedModels() {
      try {
        const result = await client.query(`${SELECT} ORDER BY m.alias LIMIT 1001`, []);
        if (result.rows.length > 1000) throw new ModelCatalogUnavailable();
        const aliases = new Set<string>();
        return result.rows.map((row) => {
          const parsed = parseRow(row);
          if (aliases.has(parsed.model.alias)) throw new ModelCatalogUnavailable();
          aliases.add(parsed.model.alias);
          return parsed.model;
        });
      } catch {
        throw new ModelCatalogUnavailable();
      }
    },
    async resolveRoute(alias) {
      identifier(alias);
      try {
        const result = await client.query(`${SELECT} WHERE m.alias = $1 LIMIT 2`, [alias]);
        if (result.rows.length === 0) return undefined;
        if (result.rows.length !== 1) throw new ModelCatalogUnavailable();
        const parsed = parseRow(result.rows[0]);
        if (parsed.model.alias !== alias) throw new ModelCatalogUnavailable();
        return parsed.route;
      } catch {
        throw new ModelCatalogUnavailable();
      }
    },
  };
}
