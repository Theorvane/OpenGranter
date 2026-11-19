import type { AuditFilters } from './audit-client.ts';
import { renderAuditRecord } from './audit-record-view.ts';
import { mountManagementBoundaryView } from './boundary-view.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import type { CsvDownloadResult } from './csv-download.ts';
import { createHistoryWorkspace } from './history-workspace.ts';
import { renderUsageRecordDetails } from './usage-record-view.ts';

/** Compatible with createCsvDownload; ownership transfers to this mount. */
export interface HistoryDownload {
  save(kind: 'usage' | 'audit', csv: string): CsvDownloadResult;
  dispose(): void;
}
type Kind = 'usage' | 'audit';

/** Explicit trusted SSO integration only. Caller MUST dispose on known session
 * expiry, logout or identity change. Does not acquire authority or activate entry.
 */
export function mountHistoryWorkspace(
  root: CatalogElement,
  request: CatalogRequest,
  download: HistoryDownload,
) {
  let disposed = false;
  let downloadDisposed = false;
  let active: Kind = 'usage';
  let generation = 0;
  let related: { principalId: string; requestId: string } | undefined;
  let captureDrafts = () => {};
  const deliveryFailed: Record<Kind, boolean> = { usage: false, audit: false };
  const filters: Record<Kind, AuditFilters> = { usage: {}, audit: {} };
  const drafts: Record<Kind, Map<keyof AuditFilters, string>> = {
    usage: new Map(),
    audit: new Map(),
  };
  const workspace = createHistoryWorkspace(request, render);

  function releaseDownload() {
    if (downloadDisposed) return;
    downloadDisposed = true;
    try {
      download.dispose();
    } catch {
      /* Teardown must still clear DOM. */
    }
  }
  function available() {
    return !disposed && workspace.snapshot().state === 'active';
  }
  function element(tag: string, text?: string) {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text: string, action: () => void, enabled = true) {
    const node = element('button', text);
    node.setAttribute('type', 'button');
    if (!enabled) node.setAttribute('disabled', '');
    const current = generation;
    node.addEventListener('click', () => {
      if (enabled && current === generation && available()) action();
    });
    return node;
  }
  async function exportCsv(kind: Kind) {
    deliveryFailed[kind] = false;
    const result = await workspace[kind].exportCsv();
    if (!available() || result.state !== 'ready') return;
    let started = false;
    try {
      started = download.save(kind, result.csv) === 'started';
    } catch {
      /* Render only the same generic, retryable delivery failure. */
    }
    // A browser adapter may synchronously dispose the identity epoch.
    if (!available()) return;
    deliveryFailed[kind] = !started;
    render();
  }
  function selectHistory(tab: Kind) {
    if (active === tab) return;
    captureDrafts();
    active = tab;
    const state = workspace[tab].snapshot().state;
    // Read before rendering: never expose the old authorized page while
    // fresh IAM is being checked, even for one synchronous render.
    if (state === 'idle') void workspace[tab].load(filters[tab]);
    else if (['ready', 'empty', 'unavailable', 'cancelled'].includes(state))
      void workspace[tab].retry();
    else render();
  }
  function render() {
    generation++;
    captureDrafts = () => {};
    if (disposed) {
      root.replaceChildren();
      return;
    }
    const snapshot = workspace.snapshot();
    if (snapshot.state !== 'active') {
      related = undefined;
      drafts.usage.clear();
      drafts.audit.clear();
      releaseDownload();
      if (snapshot.state === 'disposed') root.replaceChildren();
      else mountManagementBoundaryView(root, snapshot.state);
      return;
    }
    const kind = active;
    const review = workspace[kind];
    const view = snapshot[kind];
    const main = element('main');
    main.append(element('h1', 'Usage and audit history'));
    const nav = element('nav');
    nav.setAttribute('aria-label', 'History views');
    for (const tab of ['usage', 'audit'] as const) {
      const node = button(tab === 'usage' ? 'Usage' : 'Audit', () => selectHistory(tab));
      node.setAttribute('aria-pressed', String(kind === tab));
      nav.append(node);
    }
    main.append(nav, element('h2', kind === 'usage' ? 'Usage' : 'Audit'));
    if (kind === 'audit' && related) {
      main.append(
        element('p', `Audit for request ${related.requestId} · Principal ${related.principalId}`),
      );
      main.append(
        element(
          'p',
          'Results are limited to your authorized view; correlation is not invoice reconciliation.',
        ),
      );
      main.append(button('Back to usage', () => selectHistory('usage')));
    }
    const controls = element('section');
    controls.setAttribute('aria-label', 'History filters');
    const values = new Map<keyof AuditFilters, CatalogElement>();
    for (const [field, name] of [
      ['principalId', 'Principal'],
      ['model', 'Model'],
      ['fromMs', 'From (Unix ms, inclusive)'],
      ['toMs', 'To (Unix ms, exclusive)'],
      ['requestId', 'Request ID'],
    ] as const) {
      const label = element('label', name);
      const input = element('input');
      input.setAttribute('type', 'text');
      input.setAttribute('aria-label', name);
      input.value = drafts[kind].get(field) ?? String(filters[kind][field] ?? '');
      label.append(input);
      controls.append(label);
      values.set(field, input);
    }
    captureDrafts = () => {
      for (const [field, node] of values) drafts[kind].set(field, node.value ?? '');
    };
    controls.append(
      button('Apply filters', () => {
        const input: {
          principalId?: string;
          model?: string;
          requestId?: string;
          fromMs?: number;
          toMs?: number;
        } = {};
        for (const [field, node] of values) drafts[kind].set(field, node.value ?? '');
        for (const field of ['principalId', 'model', 'requestId'] as const) {
          const value = values.get(field)?.value ?? '';
          if (value !== '') input[field] = value;
        }
        for (const field of ['fromMs', 'toMs'] as const) {
          const value = values.get(field)?.value ?? '';
          if (value !== '')
            input[field] = /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : Number.NaN;
        }
        if (kind === 'audit') related = undefined;
        filters[kind] = input;
        void review.load(input);
      }),
    );
    main.append(controls);
    const status = element('p');
    status.setAttribute('role', 'status');
    const messages: Record<string, string> = {
      idle: 'Choose filters to load history.',
      loading: 'Loading history…',
      empty: 'No history matches these filters.',
      ready: `${view.data.length} records shown.`,
      invalid_query: 'Invalid filters. Check identifiers and time range.',
      unavailable: 'History unavailable. Try again.',
      cancelled: 'History request cancelled.',
      unauthenticated: 'Sign-in required.',
      denied: 'Access denied.',
    };
    status.textContent = messages[view.state] ?? 'History unavailable.';
    if (['invalid_query', 'unavailable', 'cancelled'].includes(view.state))
      status.setAttribute('role', 'alert');
    main.append(status);
    const rows = element('ul');
    rows.setAttribute('aria-label', `${kind} records`);
    if (kind === 'usage')
      for (const row of snapshot.usage.data) {
        const item = element('li');
        item.append(
          element(
            'p',
            `${row.principalId} · ${row.modelAlias} · ${row.requestId} · ${row.occurredAt}`,
          ),
        );
        item.append(
          element(
            'p',
            `Usage: ${row.usage.status}; total tokens: ${row.usage.totalTokens ?? 'Unknown'}`,
          ),
        );
        item.append(
          element(
            'p',
            `Estimated cost: ${row.estimatedCost ? `${row.estimatedCost.amountDecimal} ${row.estimatedCost.currency} (price ${row.estimatedCost.priceVersion})` : 'Unknown'}`,
          ),
        );
        item.append(
          element(
            'p',
            `Reported cost: ${row.upstreamBilledCost ? `${row.upstreamBilledCost.amountDecimal} ${row.upstreamBilledCost.currency} (${row.upstreamBilledCost.source})` : 'Unknown'}`,
          ),
        );
        item.append(
          element(
            'p',
            `Cost comparison: ${row.costComparison.status}; reported minus estimate: ${row.costComparison.reportedMinusEstimated ?? 'Unknown'}`,
          ),
        );
        if (row.possibleDuplicate) item.append(element('p', 'Possible duplicate'));
        if (row.possiblyBilled)
          item.append(element('p', 'Possibly billed; not an invoice reconciliation'));
        const relatedButton = button('View related audit', () => {
          captureDrafts();
          related = { principalId: row.principalId, requestId: row.requestId };
          filters.audit = { ...related };
          drafts.audit.clear();
          deliveryFailed.audit = false;
          active = 'audit';
          // load synchronously clears old audit rows/cursor and publishes loading.
          // Do not copy usage time/model filters: related events may differ.
          void workspace.audit.load(filters.audit);
        });
        relatedButton.setAttribute(
          'aria-label',
          `View related audit for request ${row.requestId} · Principal ${row.principalId}`,
        );
        item.append(relatedButton);
        item.append(renderUsageRecordDetails(root, row));
        item.append(
          button('View attempts for this request', () => {
            // Exact intersection, not an organization-wide lookup. Clear the
            // opaque cursor by loading afresh; retain applied time/model bounds.
            filters.usage = { ...filters.usage, requestId: row.requestId };
            drafts.usage.set('requestId', row.requestId);
            void workspace.usage.load(filters.usage);
          }),
        );
        rows.append(item);
      }
    else
      for (const row of snapshot.audit.data) {
        rows.append(renderAuditRecord(root, row));
      }
    main.append(rows);
    main.append(
      button(
        'Previous page',
        () => {
          void review.previous();
        },
        view.canPrevious,
      ),
    );
    main.append(
      button(
        'Next page',
        () => {
          void review.next();
        },
        view.canNext,
      ),
    );
    main.append(
      button(
        'Refresh current page',
        () => {
          void review.retry();
        },
        view.state === 'ready' || view.state === 'empty',
      ),
    );
    if (view.state === 'unavailable' || view.state === 'cancelled')
      main.append(
        button('Retry', () => {
          void review.retry();
        }),
      );
    main.append(
      button(
        'Download current page CSV',
        () => {
          void exportCsv(kind);
        },
        (view.state === 'ready' || view.state === 'empty') && view.exportState !== 'loading',
      ),
    );
    main.append(
      element('p', 'CSV downloads only this page. Exported files cannot be erased on logout.'),
    );
    if (view.exportState !== 'idle' || deliveryFailed[kind]) {
      const message = element(
        'p',
        view.exportState === 'loading' ? 'Preparing CSV…' : 'CSV unavailable. Try again.',
      );
      message.setAttribute('role', view.exportState === 'loading' ? 'status' : 'alert');
      main.append(message);
    }
    root.replaceChildren(main);
  }
  render();
  void workspace.usage.load();
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      related = undefined;
      captureDrafts = () => {};
      drafts.usage.clear();
      drafts.audit.clear();
      generation++;
      workspace.dispose();
      releaseDownload();
      root.replaceChildren();
    },
  });
}
