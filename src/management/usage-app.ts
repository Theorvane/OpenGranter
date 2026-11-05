import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import type { CatalogRequest } from './catalog-client.ts';
import { renderUsageAttemptDetails } from './usage-attempt-details.ts';
import { createManagementUsageClient, type UsageFilters, type UsagePage } from './usage-client.ts';

export interface UsageElement {
  textContent: string | null;
  value?: string;
  ownerDocument: { createElement(tag: string): UsageElement };
  setAttribute(name: string, value: string): void;
  append(...nodes: UsageElement[]): void;
  replaceChildren(...nodes: UsageElement[]): void;
  addEventListener(type: string, listener: () => void): void;
  focus(): void;
}
export interface UsageAuthorityOptions {
  readonly now?: () => number;
  /** Must invoke callbacks asynchronously and return cancellation. */
  readonly schedule?: (delay: number, callback: () => void) => () => void;
}
/** Disconnected by default. authorize enforces a trusted deadline; low-level connect
 * requires external expiry clearing. Both require clear on logout/identity/permission
 * changes and dispose on unmount. No session, token storage or runtime activation.
 */
export function mountManagementUsage(root: UsageElement, options: UsageAuthorityOptions = {}) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((delay, callback) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  let expiresAt: number | undefined;
  let cancelExpiry: (() => void) | undefined;
  let authorityRevision = 0;
  function expired() {
    if (expiresAt === undefined) return false;
    const time = now();
    if (!Number.isFinite(time) || time >= expiresAt) {
      clear('expired');
      return true;
    }
    return false;
  }
  function arm(current: number) {
    if (current !== authorityRevision || disposed || expiresAt === undefined || expired()) return;
    const delay = Math.max(1, Math.min(2147483647, expiresAt - now()));
    cancelExpiry = schedule(delay, () => {
      if (current !== authorityRevision || disposed) return;
      cancelExpiry = undefined;
      if (!expired()) arm(current);
    });
  }
  let client: ReturnType<typeof createManagementUsageClient> | undefined;
  let revision = 0;
  let disposed = false;
  let filters: UsageFilters = {};
  let page: UsagePage | undefined;
  let previous: readonly UsageFilters[] = [];
  let state = 'unauthenticated';
  let csvUrl: string | undefined;
  let csvMore = false;
  let csvNext: UsageFilters | undefined;
  function revoke() {
    if (csvUrl) URL.revokeObjectURL(csvUrl);
    csvUrl = undefined;
    csvMore = false;
    csvNext = undefined;
  }
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text: string, action: () => void) => {
    const node = element('button', text);
    node.setAttribute('type', 'button');
    node.addEventListener('click', action);
    return node;
  };
  function render(moveFocus = false) {
    if (disposed) return;
    const main = element('section');
    const heading = element('h1', 'Usage history');
    heading.setAttribute('tabindex', '-1');
    main.append(heading);
    const messages: Record<string, string> = {
      unauthenticated: 'Sign-in required.',
      expired: 'Session expired. Sign in again.',
      denied: 'Access denied.',
      loading: 'Loading usage…',
      exporting: 'Preparing CSV page…',
      invalid_query: 'Invalid usage filters.',
      unavailable: 'Usage unavailable. Try again later.',
      cancelled: 'Request cancelled. Try again.',
    };
    if (state !== 'ready') {
      const message = element('p', messages[state] ?? 'Usage unavailable.');
      message.setAttribute(
        'role',
        state === 'loading' || state === 'exporting' ? 'status' : 'alert',
      );
      main.append(message);
    }
    if (client && !['unauthenticated', 'expired', 'denied'].includes(state)) {
      const form = element('div');
      const inputs: Record<string, UsageElement> = {};
      for (const [key, label, kind] of [
        ['principalId', 'Principal ID', 'text'],
        ['model', 'Model', 'text'],
        ['fromMs', 'From (epoch milliseconds)', 'number'],
        ['toMs', 'To (epoch milliseconds, exclusive)', 'number'],
        ['limit', 'Page size (1–100)', 'number'],
      ] as const) {
        const wrapper = element('label', label);
        const input = element('input');
        input.setAttribute('type', kind);
        input.value = String(filters[key] ?? '');
        if (kind === 'number') {
          input.setAttribute('min', key === 'limit' ? '1' : '0');
          input.setAttribute('step', '1');
          if (key === 'limit') input.setAttribute('max', '100');
        }
        wrapper.append(input);
        form.append(wrapper);
        inputs[key] = input;
      }
      form.append(
        button('Apply filters', () => {
          const next: Record<string, string | number> = {};
          for (const [key, input] of Object.entries(inputs)) {
            const value = (input.value ?? '').trim();
            if (value)
              next[key] = ['fromMs', 'toMs', 'limit'].includes(key) ? Number(value) : value;
          }
          void load(next);
        }),
      );
      main.append(form);
      if (state === 'loading' || state === 'exporting')
        main.append(button('Cancel request', cancel));
      if (state !== 'loading' && state !== 'exporting')
        main.append(
          button('Retry / first page', () => {
            const { cursor: _cursor, ...first } = filters;
            void load(first);
          }),
        );
    }
    if (state === 'ready' && page) {
      if (!page.records.length) {
        const empty = element('p', 'No usage records.');
        empty.setAttribute('role', 'status');
        main.append(empty);
      } else {
        const table = element('table');
        table.append(element('caption', 'Usage records — current page'));
        const head = element('tr');
        for (const text of [
          'Time (epoch ms)',
          'Principal',
          'Model',
          'Outcome',
          'Total tokens',
          'Estimated cost',
          'Billed cost',
          'Usage status',
          'Possibly billed',
          'Possible duplicate',
          'Attempt details',
        ]) {
          const cell = element('th', text);
          cell.setAttribute('scope', 'col');
          head.append(cell);
        }
        const thead = element('thead');
        thead.append(head);
        table.append(thead);
        const body = element('tbody');
        for (const record of page.records) {
          const row = element('tr');
          for (const text of [
            String(record.occurredAt),
            record.principalId,
            record.modelAlias,
            record.outcome,
            record.usage.totalTokens === null ? 'Unknown' : String(record.usage.totalTokens),
            record.estimatedCost
              ? `${record.estimatedCost.amountDecimal} ${record.estimatedCost.currency}`
              : 'Unknown',
            record.upstreamBilledCost
              ? `${record.upstreamBilledCost.amountDecimal} ${record.upstreamBilledCost.currency}`
              : 'Unknown',
            record.usage.status,
            record.possiblyBilled ? 'Yes' : 'No',
            record.possibleDuplicate ? 'Yes' : 'No',
          ])
            row.append(element('td', text));
          const inspection = element('td');
          inspection.append(renderUsageAttemptDetails(root.ownerDocument, record));
          row.append(inspection);
          body.append(row);
        }
        table.append(body);
        main.append(table);
      }
      if (previous.length) {
        const target = previous.at(-1);
        const remaining = previous.slice(0, -1);
        if (target)
          main.append(
            button('Previous page', () => {
              void load(target, remaining);
            }),
          );
      }
      if (page.hasMore && page.nextCursor) {
        const cursor = page.nextCursor;
        const history = [...previous, { ...filters }];
        const next = { ...filters, cursor };
        main.append(
          button('Next page', () => {
            void load(next, history);
          }),
        );
      }
      main.append(
        button('Refresh current page', () => {
          void load({ ...filters }, [...previous]);
        }),
        button('Export current page CSV', () => {
          void exportCsv();
        }),
      );
      if (csvUrl) {
        const download = element('a', 'Download usage.csv');
        download.setAttribute('href', csvUrl);
        download.setAttribute('download', 'usage.csv');
        main.append(download);
        const note = element(
          'p',
          csvMore
            ? 'CSV is one page; more records are available.'
            : 'CSV contains the current page only.',
        );
        note.setAttribute('role', 'status');
        main.append(note);
        if (csvNext) {
          // Capture only this returned page cursor; detached controls cannot replay it.
          const next = csvNext;
          main.append(
            button('Export next CSV page', () => {
              if (csvNext === next) void exportCsv(next);
            }),
          );
        }
      }
    }
    root.replaceChildren(main);
    if (moveFocus) heading.focus();
  }
  function cancel() {
    if (disposed || !client || expired() || (state !== 'loading' && state !== 'exporting')) return;
    ++revision;
    client.invalidate();
    page = undefined;
    previous = [];
    revoke();
    state = 'cancelled';
    render(true);
  }
  async function load(next: UsageFilters, history: readonly UsageFilters[] = []) {
    if (!client || disposed || expired()) return;
    const current = ++revision;
    revoke();
    filters = { ...next };
    previous = [];
    page = undefined;
    state = 'loading';
    render();
    const result = await client.list(filters);
    if (disposed || revision !== current || expired()) return;
    if (result.state === 'unauthenticated' || result.state === 'denied') {
      clear(result.state);
      return;
    }
    state = result.state;
    if (result.state === 'ready') {
      page = result.data;
      previous = history;
    }
    render(true);
  }
  async function exportCsv(exportFilters: UsageFilters = filters) {
    if (!client || disposed || expired() || state !== 'ready') return;
    const current = ++revision;
    revoke();
    state = 'exporting';
    render();
    const result = await client.csv(exportFilters);
    if (disposed || revision !== current || expired()) return;
    if (result.state === 'unauthenticated' || result.state === 'denied') {
      clear(result.state);
      return;
    }
    if (result.state === 'ready') {
      csvUrl = URL.createObjectURL(new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' }));
      csvMore = result.data.hasMore;
      csvNext =
        result.data.hasMore && result.data.nextCursor !== null
          ? { ...exportFilters, cursor: result.data.nextCursor }
          : undefined;
      state = 'ready';
    } else {
      page = undefined;
      previous = [];
      state = result.state;
    }
    render(true);
  }
  function clear(reason: 'unauthenticated' | 'expired' | 'denied' = 'unauthenticated') {
    ++authorityRevision;
    cancelExpiry?.();
    cancelExpiry = undefined;
    expiresAt = undefined;
    ++revision;
    client?.invalidate();
    client = undefined;
    filters = {};
    previous = [];
    page = undefined;
    revoke();
    state = reason;
    render();
  }
  render();
  return {
    /** Trusted session integration. Deadline is not authentication or an IAM grant. */
    async authorize(grant: CatalogAuthorityGrant) {
      if (disposed) return;
      clear();
      const time = now();
      if (
        !Number.isSafeInteger(grant.expiresAt) ||
        !Number.isFinite(time) ||
        grant.expiresAt <= time
      ) {
        clear('expired');
        return;
      }
      expiresAt = grant.expiresAt;
      client = createManagementUsageClient(grant.request);
      arm(authorityRevision);
      await load({});
    },
    /** Low-level port: caller must supply and clear its own lifecycle. */
    async connect(request: CatalogRequest) {
      if (disposed) return;
      clear();
      client = createManagementUsageClient(request);
      await load({});
    },
    clear,
    dispose() {
      clear();
      disposed = true;
      root.replaceChildren();
    },
  };
}
