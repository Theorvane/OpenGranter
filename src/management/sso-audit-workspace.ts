import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import {
  createManagementSsoAuditClient,
  type SsoAuditCsvPage,
  type SsoAuditFilters,
  type SsoAuditPage,
} from './sso-audit-client.ts';

type ClearState = 'unauthenticated' | 'expired' | 'denied' | 'disposed' | 'unavailable';
export interface SsoAuditWorkspaceSnapshot {
  readonly state:
    | ClearState
    | 'idle'
    | 'loading'
    | 'ready'
    | 'empty'
    | 'exporting'
    | 'invalid_query'
    | 'unavailable'
    | 'cancelled';
  readonly filters: SsoAuditFilters;
  readonly page?: SsoAuditPage;
  readonly csv?: SsoAuditCsvPage;
  readonly canNext: boolean;
  readonly canPrevious: boolean;
}
export interface SsoAuditWorkspaceOptions {
  readonly now?: () => number;
  /** Callback must be asynchronous. Returns timer cancellation. */
  readonly schedule?: (delay: number, callback: () => void) => () => void;
  readonly onChange?: (snapshot: SsoAuditWorkspaceSnapshot) => void;
}

/** Explicit trusted composition only. Host clears on policy/principal changes. */
export function createManagementSsoAuditWorkspace(options: SsoAuditWorkspaceOptions = {}) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((delay, callback) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let client: ReturnType<typeof createManagementSsoAuditClient> | undefined;
  let expiry: number | undefined;
  let cancelTimer: (() => void) | undefined;
  let revision = 0;
  let disposed = false;
  let state: SsoAuditWorkspaceSnapshot['state'] = 'unauthenticated';
  let filters: SsoAuditFilters = {};
  let history: SsoAuditFilters[] = [];
  let page: SsoAuditPage | undefined;
  let csv: SsoAuditCsvPage | undefined;
  const busy = () => state === 'loading' || state === 'exporting';
  function snapshot(): SsoAuditWorkspaceSnapshot {
    if (client) valid();
    return structuredClone({
      state,
      filters,
      ...(page ? { page } : {}),
      ...(csv ? { csv } : {}),
      canNext: !!page?.hasMore && !busy(),
      canPrevious: history.length > 0 && !!page && !busy(),
    });
  }
  function notify() {
    try {
      options.onChange?.(snapshot());
    } catch {
      /* Observer errors never interrupt cleanup. */
    }
  }
  function clock() {
    try {
      const value = now();
      return Number.isFinite(value) && value >= 0 ? value : NaN;
    } catch {
      return NaN;
    }
  }
  function clear(reason: ClearState = 'unauthenticated') {
    if (disposed) return;
    revision++;
    if (reason === 'disposed') disposed = true;
    client?.invalidate();
    client = undefined;
    expiry = undefined;
    const cleanup = cancelTimer;
    cancelTimer = undefined;
    page = undefined;
    csv = undefined;
    filters = {};
    history = [];
    state = reason;
    try {
      cleanup?.();
    } catch {
      /* Private state is already gone. */
    }
    notify();
  }
  function valid() {
    if (!client || expiry === undefined || disposed) return false;
    const current = revision;
    const time = clock();
    if (current !== revision || !client || expiry === undefined || disposed) return false;
    if (!Number.isFinite(time) || time >= expiry) {
      clear('expired');
      return false;
    }
    return true;
  }
  function arm(current: number) {
    if (current !== revision || !valid() || expiry === undefined) return;
    const time = clock();
    if (current !== revision || expiry === undefined || disposed) return;
    if (!Number.isFinite(time) || time >= expiry) {
      clear('expired');
      return;
    }
    try {
      cancelTimer = schedule(Math.max(1, Math.min(2147483647, expiry - time)), () => {
        if (current !== revision || disposed) return;
        cancelTimer = undefined;
        arm(current);
      });
    } catch {
      if (current === revision) clear('unavailable');
    }
  }
  function authorize(grant: CatalogAuthorityGrant & { readonly principalId: string }) {
    if (disposed) return;
    // Do not publish an intermediate clear: an observer cannot replace authority
    // halfway through a renewal and then be overwritten by the outer operation.
    const current = ++revision;
    client?.invalidate();
    client = undefined;
    const cleanup = cancelTimer;
    cancelTimer = undefined;
    expiry = undefined;
    page = undefined;
    csv = undefined;
    history = [];
    filters = {};
    try {
      cleanup?.();
    } catch {
      /* Cleanup does not grant authority. */
    }
    if (current !== revision || disposed) return;
    try {
      const captured = {
        request: grant.request,
        expiresAt: grant.expiresAt,
        principalId: grant.principalId,
      };
      const time = clock();
      if (current !== revision || disposed) return;
      if (
        !Number.isFinite(time) ||
        !Number.isFinite(captured.expiresAt) ||
        captured.expiresAt <= time
      ) {
        clear('expired');
        return;
      }
      const next = createManagementSsoAuditClient(captured.request, captured.principalId);
      if (current !== revision || disposed) {
        next.invalidate();
        return;
      }
      client = next;
      expiry = captured.expiresAt;
      state = 'idle';
      arm(current);
    } catch {
      if (current === revision) clear('unavailable');
      return;
    }
    if (current === revision && !disposed) notify();
  }
  async function read(next: SsoAuditFilters, previous: SsoAuditFilters[]) {
    if (!valid() || !client) return;
    const currentClient = client;
    const current = ++revision;
    currentClient.invalidate();
    // Expiry timers track authority and must survive read revisions.
    const cleanup = cancelTimer;
    cancelTimer = undefined;
    try {
      cleanup?.();
    } catch {
      /* Best effort. */
    }
    if (current !== revision || currentClient !== client || disposed) return;
    filters = { ...next };
    history = previous;
    page = undefined;
    csv = undefined;
    state = 'loading';
    arm(current);
    notify();
    if (current !== revision || currentClient !== client || !valid()) return;
    const result = await currentClient.list(filters);
    if (current !== revision || currentClient !== client || !valid()) return;
    if (result.state === 'unauthenticated' || result.state === 'denied') {
      clear(result.state);
      return;
    }
    if (result.state === 'ready') {
      page = result.data;
      state = page.events.length ? 'ready' : 'empty';
    } else {
      state = result.state;
    }
    notify();
  }
  async function load(next: SsoAuditFilters = {}) {
    await read({ ...next }, []);
  }
  async function refresh() {
    if (!valid() || busy() || state === 'invalid_query') return;
    await read({ ...filters }, [...history]);
  }
  async function next() {
    if (!valid() || busy() || !page?.hasMore || !page.nextCursor) return;
    await read({ ...filters, cursor: page.nextCursor }, [...history, { ...filters }]);
  }
  async function previous() {
    if (!valid() || busy() || !page || !history.length) return;
    const target = history.at(-1);
    if (target) await read({ ...target }, history.slice(0, -1));
  }
  async function exportCsv() {
    if (!valid() || busy() || !page || !client) return;
    const current = revision;
    const currentClient = client;
    state = 'exporting';
    csv = undefined;
    notify();
    if (current !== revision || currentClient !== client || !valid()) return;
    const result = await currentClient.csv({ ...filters });
    if (current !== revision || currentClient !== client || !valid()) return;
    if (result.state === 'unauthenticated' || result.state === 'denied') {
      clear(result.state);
      return;
    }
    if (result.state === 'ready') {
      csv = result.data;
      state = page?.events.length ? 'ready' : 'empty';
    } else {
      page = undefined;
      state = result.state;
    }
    notify();
  }
  function dispose() {
    if (disposed) return;
    // Prevent reentrant observers from renewing a dying workspace.
    clear('disposed');
  }
  return { snapshot, authorize, load, refresh, next, previous, exportCsv, clear, dispose };
}
