import { type AuditFilters, type AuditPage, createManagementAuditClient } from './audit-client.ts';
import { renderAuditEventMetadata, renderAuditRequestGroups } from './audit-request-groups.ts';
import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { UsageElement } from './usage-app.ts';
import { formatUsageTime, parseUsageUtcInput, usageUtcInput } from './usage-time.ts';

export interface AuditAuthorityOptions {
  readonly now?: () => number;
  /** Must invoke callbacks asynchronously and return cancellation. */
  readonly schedule?: (delay: number, callback: () => void) => () => void;
}
/** Disconnected by default. authorize enforces a trusted deadline; low-level connect
 * requires external expiry clearing. Both require clear on logout/identity/permission
 * changes and dispose on unmount. No session, token storage or runtime activation.
 */
export function mountManagementAudit(root: UsageElement, options: AuditAuthorityOptions = {}) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((delay, callback) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  // An unreadable trusted clock cannot establish a still-valid deadline.
  function clock() {
    try {
      const time = now();
      return Number.isFinite(time) && time >= 0 ? time : NaN;
    } catch {
      return NaN;
    }
  }
  let expiresAt: number | undefined;
  let cancelExpiry: (() => void) | undefined;
  let authorityRevision = 0;
  function expired() {
    if (expiresAt === undefined) return false;
    const time = clock();
    if (!Number.isFinite(time) || time >= expiresAt) {
      clear('expired');
      return true;
    }
    return false;
  }
  function arm(current: number) {
    if (current !== authorityRevision || disposed || expiresAt === undefined || expired()) return;
    const remaining = expiresAt - clock();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clear('expired');
      return;
    }
    const delay = Math.max(1, Math.min(2147483647, remaining));
    cancelExpiry = schedule(delay, () => {
      if (current !== authorityRevision || disposed) return;
      cancelExpiry = undefined;
      if (!expired()) arm(current);
    });
  }
  let client: ReturnType<typeof createManagementAuditClient> | undefined;
  let revision = 0;
  let renderRevision = 0;
  let disposed = false;
  let filters: AuditFilters = {};
  // Submitted text belongs to this authority, not to numeric transport values.
  // In particular NaN must not erase a rejected UTC range on rerender.
  let draftFilters: Readonly<Record<string, string>> | undefined;
  let page: AuditPage | undefined;
  let previous: readonly AuditFilters[] = [];
  let state = 'unauthenticated';
  let csvUrl: string | undefined;
  let csvMore = false;
  let csvNext: AuditFilters | undefined;
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
    const rendered = renderRevision;
    node.addEventListener('click', (event) => {
      event?.preventDefault();
      // Detached controls must not consume renewed authority or cancel newer work.
      if (disposed || rendered !== renderRevision || expired()) return;
      action();
    });
    return node;
  };
  function render(moveFocus = false) {
    if (disposed) return;
    ++renderRevision;
    const main = element('section');
    const heading = element('h1', 'Audit history');
    heading.setAttribute('tabindex', '-1');
    main.append(heading);
    const messages: Record<string, string> = {
      unauthenticated: 'Sign-in required.',
      expired: 'Session expired. Sign in again.',
      denied: 'Access denied.',
      loading: 'Loading audit…',
      exporting: 'Preparing CSV page…',
      invalid_query: 'Invalid audit filters.',
      unavailable: 'Audit unavailable. Try again later.',
      cancelled: 'Request cancelled. Try again.',
    };
    if (state !== 'ready') {
      const message = element('p', messages[state] ?? 'Audit unavailable.');
      message.setAttribute(
        'role',
        state === 'loading' || state === 'exporting' ? 'status' : 'alert',
      );
      main.append(message);
    }
    if (client && !['unauthenticated', 'expired', 'denied'].includes(state)) {
      const form = element('form');
      form.setAttribute('aria-label', 'Audit history filters');
      // Application validation keeps rejected values editable and consistent.
      form.setAttribute('novalidate', '');
      form.setAttribute('autocomplete', 'off');
      const inputs: Record<string, UsageElement> = {};
      for (const [key, label, kind] of [
        ['principalId', 'Principal ID', 'text'],
        ['model', 'Model', 'text'],
        ['fromMs', 'From (UTC)', 'datetime-local'],
        ['toMs', 'To (UTC, exclusive)', 'datetime-local'],
        ['limit', 'Page size (1–100)', 'number'],
      ] as const) {
        const wrapper = element('label', label);
        const input = element('input');
        input.setAttribute('type', kind);
        input.value =
          draftFilters?.[key] ??
          (kind === 'datetime-local'
            ? filters[key] === undefined
              ? ''
              : usageUtcInput(filters[key] as number)
            : String(filters[key] ?? ''));
        if (kind === 'datetime-local') {
          input.setAttribute('min', '1970-01-01T00:00');
          input.setAttribute('max', '9999-12-31T23:59:59.999');
          input.setAttribute('step', '0.001');
        }
        if (kind === 'number') {
          input.setAttribute('min', key === 'limit' ? '1' : '0');
          input.setAttribute('step', '1');
          if (key === 'limit') input.setAttribute('max', '100');
        }
        wrapper.append(input);
        form.append(wrapper);
        inputs[key] = input;
      }
      const rendered = renderRevision;
      const apply = () => {
        if (disposed || rendered !== renderRevision || expired()) return;
        draftFilters = Object.fromEntries(
          Object.entries(inputs).map(([key, input]) => [key, input.value ?? '']),
        );
        const next: Record<string, string | number> = {};
        for (const [key, input] of Object.entries(inputs)) {
          const value = (input.value ?? '').trim();
          if (value)
            next[key] = ['fromMs', 'toMs'].includes(key)
              ? parseUsageUtcInput(value)
              : key === 'limit'
                ? Number(value)
                : value;
        }
        void load(next);
      };
      form.addEventListener('submit', (event) => {
        // Prevent navigation even for a stale/detached form.
        event?.preventDefault();
        apply();
      });
      const applyButton = button('Apply filters', apply);
      // Click consumes its default submit above, so Enter/click cannot double-fetch.
      applyButton.setAttribute('type', 'submit');
      form.append(
        applyButton,
        button('Clear filters', () => {
          draftFilters = undefined;
          void load({});
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
      main.append(
        element(
          'p',
          'Authorized audit metadata — current page only. No prompt or response content.',
        ),
      );
      if (!page.events.length) {
        const empty = element('p', 'No audit events.');
        empty.setAttribute('role', 'status');
        main.append(empty);
      } else {
        const table = element('table');
        table.append(element('caption', 'Audit events — current page'));
        const head = element('tr');
        for (const text of [
          'Event ID',
          'Time (UTC)',
          'Kind',
          'Principal',
          'Request ID',
          'Metadata',
        ]) {
          const cell = element('th', text);
          cell.setAttribute('scope', 'col');
          head.append(cell);
        }
        const thead = element('thead');
        thead.append(head);
        table.append(thead);
        const body = element('tbody');
        for (const event of page.events) {
          const row = element('tr');
          for (const text of [
            event.eventId,
            formatUsageTime(event.occurredAt),
            event.kind,
            event.principalId,
            event.requestId,
          ])
            row.append(element('td', text));
          const cell = element('td');
          const details = element('details');
          details.append(element('summary', `Inspect event ${event.eventId}`));
          details.append(renderAuditEventMetadata(root.ownerDocument, event));
          cell.append(details);
          row.append(cell);
          body.append(row);
        }
        table.append(body);
        main.append(table, renderAuditRequestGroups(root.ownerDocument, page.events));
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
        const download = element('a', 'Download audit.csv');
        download.setAttribute('href', csvUrl);
        download.setAttribute('download', 'audit.csv');
        const rendered = renderRevision;
        const url = csvUrl;
        for (const type of ['click', 'auxclick', 'contextmenu'])
          download.addEventListener(type, (event) => {
            // Native anchors have a default action: button guards do not protect it.
            // Check the trusted deadline even if the expiry timer was suspended.
            if (disposed || rendered !== renderRevision || url !== csvUrl || expired())
              event?.preventDefault();
          });
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
  async function load(next: AuditFilters, history: readonly AuditFilters[] = []) {
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
  async function exportCsv(exportFilters: AuditFilters = filters) {
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
    const cancel = cancelExpiry;
    cancelExpiry = undefined;
    try {
      cancel?.();
    } catch {
      // Timer cleanup is best-effort; protected data cleanup is mandatory.
    }
    expiresAt = undefined;
    ++revision;
    client?.invalidate();
    client = undefined;
    filters = {};
    draftFilters = undefined;
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
      const time = clock();
      if (
        typeof grant.request !== 'function' ||
        !Number.isSafeInteger(grant.expiresAt) ||
        !Number.isFinite(time) ||
        grant.expiresAt <= time
      ) {
        clear('expired');
        return;
      }
      expiresAt = grant.expiresAt;
      client = createManagementAuditClient(grant.request);
      arm(authorityRevision);
      await load({});
    },
    /** Low-level port: caller must supply and clear its own lifecycle. */
    async connect(request: CatalogRequest) {
      if (disposed) return;
      clear();
      client = createManagementAuditClient(request);
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
