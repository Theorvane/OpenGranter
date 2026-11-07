import { encodeCsv } from '../export/csv.ts';
import type { AuditClientResult, AuditFilters } from './audit-client.ts';
import type { UsageElement } from './usage-app.ts';
import { formatUsageTime, parseUsageUtcInput } from './usage-time.ts';

export interface AuditReviewClient {
  list(filters?: AuditFilters): Promise<AuditClientResult>;
  invalidate(): void;
}
/** Opt-in view only: the trusted owner supplies the bounded audit client and must
 * clear on logout/expiry/identity/permission changes; dispose on unmount.
 * connect is NOT authentication. No transport, session or ambient authority.
 */
export function mountManagementAudit(root: UsageElement) {
  let client: AuditReviewClient | undefined;
  let disposed = false;
  let revision = 0;
  let renderRevision = 0;
  let filters: AuditFilters = {};
  let previous: readonly AuditFilters[] = [];
  let drafts = { principal: '', model: '', from: '', to: '' };
  let result: AuditClientResult | undefined;
  let downloadUrl: string | undefined;
  function revokeDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
  }
  let status = 'Authentication required';
  const node = (tag: string, text?: string) => {
    const element = root.ownerDocument.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function render() {
    if (disposed) return;
    const rendered = ++renderRevision;
    const section = node('section');
    section.setAttribute('aria-label', 'Audit review');
    section.append(node('h2', 'Audit review'));
    const message = node('p', status);
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    section.append(message);
    section.append(
      node('p', 'Current page only. Metadata only; no content audit or billing totals.'),
    );
    if (client) {
      const inputs = {} as Record<keyof typeof drafts, UsageElement>;
      for (const [key, label] of [
        ['principal', 'Principal ID'],
        ['model', 'Model'],
        ['from', 'From UTC'],
        ['to', 'To UTC'],
      ] as const) {
        const wrapper = node('label', label);
        const input = node('input');
        input.setAttribute('aria-label', label);
        input.setAttribute('type', key === 'from' || key === 'to' ? 'datetime-local' : 'text');
        if (key === 'from' || key === 'to') input.setAttribute('step', '0.001');
        input.value = drafts[key];
        inputs[key] = input;
        wrapper.append(input);
        section.append(wrapper);
      }
      const button = (label: string, action: () => void) => {
        const control = node('button', label);
        control.setAttribute('type', 'button');
        control.addEventListener('click', () => {
          if (!disposed && client && rendered === renderRevision) action();
        });
        section.append(control);
      };
      button('Apply filters', () => {
        drafts = {
          principal: inputs.principal.value ?? '',
          model: inputs.model.value ?? '',
          from: inputs.from.value ?? '',
          to: inputs.to.value ?? '',
        };
        const from = drafts.from ? parseUsageUtcInput(drafts.from) : undefined;
        const to = drafts.to ? parseUsageUtcInput(drafts.to) : undefined;
        if (
          (from !== undefined && !Number.isFinite(from)) ||
          (to !== undefined && !Number.isFinite(to)) ||
          (from !== undefined && to !== undefined && from >= to)
        ) {
          revision++;
          revokeDownload();
          client?.invalidate();
          result = undefined;
          previous = [];
          status = 'Invalid filters';
          render();
          return;
        }
        filters = {
          ...(drafts.principal === '' ? {} : { principalId: drafts.principal }),
          ...(drafts.model === '' ? {} : { model: drafts.model }),
          ...(from === undefined ? {} : { fromMs: from }),
          ...(to === undefined ? {} : { toMs: to }),
          limit: 25,
        };
        void load(filters);
      });
      if (result?.state === 'ready') {
        const exportQuery = { ...filters };
        const exportHistory = [...previous];
        button('Prepare current-page CSV', () => {
          void load(exportQuery, exportHistory, true);
        });
        if (downloadUrl) {
          const link = node('a', 'Download current-page CSV');
          link.setAttribute('href', downloadUrl);
          link.setAttribute('download', 'opengranter-audit-page.csv');
          link.addEventListener('click', (event) => {
            if (disposed || !client || rendered !== renderRevision) event?.preventDefault();
          });
          section.append(link);
        }
        button('First page', () => {
          const { cursor: _cursor, ...first } = filters;
          void load(first);
        });
        const target = previous.at(-1);
        const remaining = previous.slice(0, -1);
        if (target)
          button('Previous page', () => {
            void load(target, remaining);
          });
        const cursor = result.data.nextCursor;
        if (cursor !== null) {
          const history = [...previous, { ...filters }];
          const next = { ...filters, cursor };
          button('Next page', () => {
            void load(next, history);
          });
        }
        const table = node('table');
        table.append(node('caption', 'Authorized audit metadata, descending event ID'));
        const header = node('tr');
        for (const label of [
          'Event ID',
          'Time UTC',
          'Kind',
          'Request ID',
          'Principal ID',
          'Model',
        ]) {
          const cell = node('th', label);
          cell.setAttribute('scope', 'col');
          header.append(cell);
        }
        table.append(header);
        for (const event of result.data.events) {
          const row = node('tr');
          for (const text of [
            event.eventId,
            formatUsageTime(event.occurredAt),
            event.kind,
            event.requestId,
            event.principalId,
            typeof event.details.modelAlias === 'string'
              ? event.details.modelAlias
              : 'Not reported',
          ])
            row.append(node('td', text));
          table.append(row);
        }
        section.append(table);
      }
    }
    root.replaceChildren(section);
  }
  async function load(
    query: AuditFilters,
    history: readonly AuditFilters[] = [],
    prepareCsv = false,
  ) {
    const active = client;
    if (!active || disposed) return;
    const current = ++revision;
    revokeDownload();
    active.invalidate();
    filters = { ...query };
    previous = [];
    result = undefined;
    status = prepareCsv ? 'Preparing current-page CSV' : 'Loading audit events';
    render();
    let response: AuditClientResult;
    try {
      response = await active.list(query);
    } catch {
      response = { state: 'unavailable' };
    }
    if (disposed || current !== revision || active !== client) return;
    if (prepareCsv && response.state === 'ready') {
      try {
        // The bounded client freshly validates server-projected metadata. Export
        // only the visible columns, never arbitrary details or attribution secrets.
        const csv = encodeCsv(
          ['event_id', 'time_utc', 'kind', 'request_id', 'principal_id', 'model'],
          response.data.events.map((event) => [
            event.eventId,
            formatUsageTime(event.occurredAt),
            event.kind,
            event.requestId,
            event.principalId,
            typeof event.details.modelAlias === 'string' ? event.details.modelAlias : null,
          ]),
        );
        downloadUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      } catch {
        revokeDownload();
        response = { state: 'unavailable' };
      }
    }
    result = response;
    switch (response.state) {
      case 'ready':
        previous = history;
        status = response.data.events.length ? 'Audit events' : 'No audit events';
        break;
      case 'invalid_query':
        status = 'Invalid filters';
        break;
      case 'unauthenticated':
        status = 'Authentication required';
        break;
      case 'denied':
        status = 'Access denied';
        break;
      case 'cancelled':
        status = 'Audit request cancelled';
        break;
      case 'unavailable':
        status = 'Audit unavailable';
        break;
    }
    render();
  }
  function clear() {
    revision++;
    revokeDownload();
    client?.invalidate();
    client = undefined;
    result = undefined;
    filters = {};
    previous = [];
    drafts = { principal: '', model: '', from: '', to: '' };
    status = 'Authentication required';
    render();
  }
  render();
  return {
    connect(next: AuditReviewClient) {
      if (disposed) return;
      clear();
      client = next;
      status = 'Choose filters and apply';
      render();
    },
    clear,
    dispose() {
      clear();
      disposed = true;
      root.replaceChildren();
    },
  };
}
