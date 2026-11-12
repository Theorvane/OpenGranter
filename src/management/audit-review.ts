import {
  type AuditExportResult,
  type AuditFilters,
  type AuditResult,
  createSsoAuditClient,
  createSsoAuditExportClient,
} from './audit-client.ts';
import type { CatalogRequest } from './catalog-client.ts';

type AuditRow = Extract<AuditResult, { state: 'ready' }>['data'][number];
type Failure = Exclude<AuditResult['state'], 'ready'>;
export interface AuditReviewSnapshot {
  readonly state: 'idle' | 'loading' | 'ready' | 'empty' | Failure;
  readonly data: readonly AuditRow[];
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly exportState: 'idle' | 'loading' | Failure;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Screen state only, never an authenticator. Supply a trusted signed-SSO request
 * port; dispose on identity change/expiry. No entry activation or download.
 */
export function createAuditReview(
  request: CatalogRequest,
  onChange?: (value: AuditReviewSnapshot) => void,
) {
  const history = createSsoAuditClient(request);
  const csv = createSsoAuditExportClient(request);
  let revision = 0;
  let exportRevision = 0;
  let blocked = false;
  let view: AuditReviewSnapshot = freeze({
    state: 'idle',
    data: [],
    canPrevious: false,
    canNext: false,
    exportState: 'idle',
  });
  let base: AuditFilters = {};
  let path: readonly (string | undefined)[] = [];
  let attempt: readonly (string | undefined)[] = [];
  let nextCursor: string | null = null;

  function publish(value: AuditReviewSnapshot) {
    view = freeze(value);
    try {
      onChange?.(view);
    } catch {
      // Rendering diagnostics must not escape or prevent data invalidation.
    }
  }
  function stop() {
    revision++;
    exportRevision++;
    history.invalidate();
    csv.invalidate();
  }
  function deny(state: 'unauthenticated' | 'denied') {
    stop();
    blocked = true;
    base = {};
    path = [];
    attempt = [];
    nextCursor = null;
    publish({ state, data: [], canPrevious: false, canNext: false, exportState: 'idle' });
  }
  function filters(target: readonly (string | undefined)[]): AuditFilters {
    const cursor = target.at(-1);
    return { ...base, ...(cursor === undefined ? {} : { cursor }) };
  }
  async function read(target: readonly (string | undefined)[]) {
    if (blocked) return;
    stop();
    const current = revision;
    attempt = [...target];
    const query = filters(target);
    publish({
      state: 'loading',
      data: [],
      canPrevious: false,
      canNext: false,
      exportState: 'idle',
    });
    if (blocked || current !== revision) return;
    const result = await history.read(query);
    if (blocked || current !== revision) return;
    if (result.state === 'unauthenticated' || result.state === 'denied') {
      deny(result.state);
    } else if (result.state === 'ready') {
      path = [...target];
      nextCursor = result.nextCursor;
      publish({
        state: result.data.length === 0 ? 'empty' : 'ready',
        data: result.data,
        canPrevious: path.length > 1,
        canNext: result.hasMore,
        exportState: 'idle',
      });
    } else {
      publish({
        state: result.state,
        data: [],
        canPrevious: false,
        canNext: false,
        exportState: 'idle',
      });
    }
  }
  return {
    snapshot: (): AuditReviewSnapshot => view,
    async load(input: AuditFilters = {}) {
      if (blocked) return;
      stop();
      const current = revision;
      path = [];
      attempt = [];
      nextCursor = null;
      base = {};
      try {
        // Read known getters once. A fresh search must never reuse a stale cursor.
        const { principalId, requestId, model, fromMs, toMs, limit } = input;
        if (blocked || revision !== current) return;
        base = Object.freeze({
          ...(principalId === undefined ? {} : { principalId }),
          ...(requestId === undefined ? {} : { requestId }),
          ...(model === undefined ? {} : { model }),
          ...(fromMs === undefined ? {} : { fromMs }),
          ...(toMs === undefined ? {} : { toMs }),
          ...(limit === undefined ? {} : { limit }),
        });
      } catch {
        if (blocked || revision !== current) return;
        publish({
          state: 'invalid_query',
          data: [],
          canPrevious: false,
          canNext: false,
          exportState: 'idle',
        });
        return;
      }
      await read([undefined]);
    },
    async next() {
      if (!blocked && view.canNext && nextCursor !== null) await read([...path, nextCursor]);
    },
    async previous() {
      if (!blocked && view.canPrevious) await read(path.slice(0, -1));
    },
    async retry() {
      if (!blocked && attempt.length > 0 && view.state !== 'loading') await read(attempt);
    },
    async exportCsv(): Promise<AuditExportResult> {
      if (blocked) return { state: 'cancelled' };
      if (view.state !== 'ready' && view.state !== 'empty') return { state: 'unavailable' };
      csv.invalidate();
      const current = revision;
      const exportId = ++exportRevision;
      const query = filters(path);
      publish({ ...view, exportState: 'loading' });
      if (blocked || current !== revision || exportId !== exportRevision)
        return { state: 'cancelled' };
      const result = await csv.read(query);
      if (blocked || current !== revision || exportId !== exportRevision)
        return { state: 'cancelled' };
      if (result.state === 'unauthenticated' || result.state === 'denied') {
        deny(result.state);
      } else {
        publish({ ...view, exportState: result.state === 'ready' ? 'idle' : result.state });
      }
      // An observer may dispose or change filters during the notification.
      if ((current !== revision || exportId !== exportRevision) && result.state === 'ready')
        return { state: 'cancelled' };
      return result;
    },
    dispose() {
      stop();
      blocked = true;
      base = {};
      path = [];
      attempt = [];
      nextCursor = null;
      publish({ state: 'idle', data: [], canPrevious: false, canNext: false, exportState: 'idle' });
    },
  };
}
