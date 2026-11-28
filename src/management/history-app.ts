import type { AuditFilters } from './audit-client.ts';
import { renderAuditRecord } from './audit-record-view.ts';
import { mountManagementBoundaryView } from './boundary-view.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import type { CsvDownloadResult } from './csv-download.ts';
import { formatHistoryTimestamp } from './history-timestamp.ts';
import { createHistoryWorkspace } from './history-workspace.ts';
import { renderUsagePageSummary } from './usage-page-summary.ts';
import { renderUsageRecordDetails } from './usage-record-view.ts';
import { parseUtcMilliseconds } from './utc-milliseconds-input.ts';

/** Compatible with createCsvDownload; ownership transfers to this mount. */
export interface HistoryDownload {
  save(kind: 'usage' | 'audit', csv: string): CsvDownloadResult;
  dispose(): void;
}
type HistoryInput = CatalogElement & {
  selectionStart?: number | null;
  selectionEnd?: number | null;
  selectionDirection?: string | null;
  setSelectionRange?(start: number, end: number, direction?: string): void;
};
type Kind = 'usage' | 'audit';

/** Explicit trusted SSO integration only. Caller MUST dispose on known session
 * expiry, logout or identity change. Does not acquire authority or activate entry.
 */
export function mountHistoryWorkspace(
  root: CatalogElement,
  request: CatalogRequest,
  download: HistoryDownload,
  initialPrincipalId?: string,
) {
  let disposed = false;
  let downloadDisposed = false;
  let active: Kind = 'usage';
  let generation = 0;
  const deliveryFailed: Record<Kind, boolean> = { usage: false, audit: false };
  // Preserve the exact target. Existing clients reject invalid history IDs
  // locally; never silently fall back to a self/unfiltered request.
  const initial = initialPrincipalId === undefined ? {} : { principalId: initialPrincipalId };
  const filters: Record<Kind, AuditFilters> = { usage: { ...initial }, audit: { ...initial } };
  const renderedInputs = new Map<keyof AuditFilters, HistoryInput>();
  let renderedKind: Kind | undefined;
  const renderedActions = new Map<string, CatalogElement>();
  const retainedInputs = new Set<CatalogElement>();
  function clearInputs() {
    for (const input of retainedInputs) input.value = '';
    retainedInputs.clear();
  }
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
  function select(kind: Kind) {
    const previous = active;
    // Stop file delivery on departure, before selecting the destination.
    // Preserve existing coalescing of pending JSON reads on a return visit.
    if (previous !== kind) workspace[previous].cancelExport();
    if (!available()) return false;
    active = kind;
    return true;
  }
  function element(tag: string, text?: string) {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text: string, action: () => void, enabled = true, submit = false) {
    const node = element('button', text);
    node.setAttribute('type', submit ? 'submit' : 'button');
    if (!enabled) node.setAttribute('disabled', '');
    // Only unique workspace controls have stable action identity. Row actions
    // may share labels and change targets after refresh/pagination.
    else if (
      [
        'Usage',
        'Audit',
        'Apply filters',
        'Discard filter edits',
        'Clear filters',
        'Cancel history request',
        'Previous page',
        'Next page',
        'Refresh current page',
        'Retry',
        'Download current page CSV',
        'Cancel CSV export',
      ].includes(text)
    )
      renderedActions.set(text, node);
    const current = generation;
    node.addEventListener('click', (event) => {
      if (submit) event?.preventDefault();
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
  function render() {
    const focused = (root.ownerDocument as { activeElement?: unknown }).activeElement;
    const focusedEntry = [...renderedInputs].find(([, input]) => input === focused);
    const restore =
      renderedKind === active && focusedEntry
        ? {
            field: focusedEntry[0],
            start: focusedEntry[1].selectionStart,
            end: focusedEntry[1].selectionEnd,
            direction: focusedEntry[1].selectionDirection,
          }
        : undefined;
    const restoreAction =
      renderedKind === active
        ? [...renderedActions].find(([, node]) => node === focused)?.[0]
        : undefined;
    renderedActions.clear();
    renderedInputs.clear();
    generation++;
    clearInputs();
    if (disposed) {
      root.replaceChildren();
      return;
    }
    const snapshot = workspace.snapshot();
    if (snapshot.state !== 'active') {
      drafts.usage.clear();
      drafts.audit.clear();
      filters.usage = {};
      filters.audit = {};
      releaseDownload();
      if (snapshot.state === 'disposed') root.replaceChildren();
      else mountManagementBoundaryView(root, snapshot.state);
      return;
    }
    const kind = active;
    const review = workspace[kind];
    const view = snapshot[kind];
    // A fresh JSON read retires the previous browser delivery attempt.
    // Local draft renders keep its failure visible until a new read/export.
    if (view.state === 'loading') deliveryFailed[kind] = false;
    const main = element('main');
    main.append(element('h1', 'Usage and audit history'));
    const nav = element('nav');
    nav.setAttribute('aria-label', 'History views');
    for (const tab of ['usage', 'audit'] as const) {
      const node = button(tab === 'usage' ? 'Usage' : 'Audit', () => {
        if (active === tab) return;
        if (!select(tab)) return;
        const state = workspace[tab].snapshot().state;
        // Read before rendering: never expose the old authorized page while
        // fresh IAM is being checked, even for one synchronous render.
        if (state === 'idle') void workspace[tab].load(filters[tab]);
        else if (['ready', 'empty', 'unavailable', 'cancelled'].includes(state))
          void workspace[tab].retry();
        else render();
      });
      node.setAttribute('aria-pressed', String(kind === tab));
      nav.append(node);
    }
    main.append(nav, element('h2', kind === 'usage' ? 'Usage' : 'Audit'));
    const controls = element('form');
    controls.setAttribute('novalidate', '');
    controls.setAttribute('aria-label', 'History filters');
    const values = new Map<keyof AuditFilters, CatalogElement>();
    const draftStatus = element('p');
    draftStatus.setAttribute('role', 'status');
    function updateDraftStatus() {
      const edited = [...values].some(([field, node]) => {
        const value = node.value ?? '';
        if ((field === 'fromMs' || field === 'toMs') && value !== '')
          return (parseUtcMilliseconds(value) ?? Number.NaN) !== filters[kind][field];
        return value !== String(filters[kind][field] ?? '');
      });
      draftStatus.textContent = edited
        ? 'Unapplied filter edits. Records, pagination and CSV still use the applied filters.'
        : '';
    }
    const inputGeneration = generation;
    for (const [field, name] of [
      ['principalId', 'Principal'],
      ['model', 'Model'],
      ['fromMs', 'From (UTC or Unix ms, inclusive)'],
      ['toMs', 'To (UTC or Unix ms, exclusive)'],
      ['requestId', 'Request ID'],
      ['limit', 'Page size (1–100, blank for default)'],
    ] as const) {
      const label = element('label', name);
      const input = element('input');
      input.setAttribute('type', 'text');
      input.setAttribute('aria-label', name);
      input.value = drafts[kind].get(field) ?? String(filters[kind][field] ?? '');
      retainedInputs.add(input);
      label.append(input);
      controls.append(label);
      values.set(field, input);
      renderedInputs.set(field, input);
      input.addEventListener('input', () => {
        if (inputGeneration !== generation || !available()) return;
        drafts[kind].set(field, input.value ?? '');
        updateDraftStatus();
      });
    }
    updateDraftStatus();
    controls.append(
      element(
        'p',
        'Time bounds: use explicit UTC, for example 2026-11-20T00:00:00.000Z, or integer Unix milliseconds. From is inclusive; To is exclusive.',
      ),
      draftStatus,
    );
    function applyFilters() {
      const input: {
        principalId?: string;
        model?: string;
        requestId?: string;
        fromMs?: number;
        toMs?: number;
        limit?: number;
      } = {};
      for (const [field, node] of values) drafts[kind].set(field, node.value ?? '');
      for (const field of ['principalId', 'model', 'requestId'] as const) {
        const value = values.get(field)?.value ?? '';
        if (value !== '') input[field] = value;
      }
      for (const field of ['fromMs', 'toMs', 'limit'] as const) {
        const value = values.get(field)?.value ?? '';
        if (value !== '')
          input[field] =
            field === 'limit'
              ? /^(0|[1-9][0-9]*)$/u.test(value)
                ? Number(value)
                : Number.NaN
              : (parseUtcMilliseconds(value) ?? Number.NaN);
      }
      filters[kind] = input;
      void review.load(input);
    }
    const formGeneration = generation;
    controls.addEventListener('submit', (event) => {
      event?.preventDefault();
      if (formGeneration === generation && available()) applyFilters();
    });
    controls.append(button('Apply filters', applyFilters, true, true));
    controls.append(
      button('Discard filter edits', () => {
        // Local rollback only: keep submitted scope, cursors and pending work.
        drafts[kind].clear();
        render();
      }),
    );
    controls.append(
      button('Clear filters', () => {
        // Explicit reset only; the existing review retires cursors and pending JSON/CSV.
        drafts[kind].clear();
        filters[kind] = {};
        deliveryFailed[kind] = false;
        void review.load({});
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
      invalid_query: 'Invalid filters. Check identifiers, time range and page size (1–100).',
      unavailable: 'History unavailable. Try again.',
      cancelled: 'History request cancelled.',
      unauthenticated: 'Sign-in required.',
      denied: 'Access denied.',
    };
    status.textContent = messages[view.state] ?? 'History unavailable.';
    if (['invalid_query', 'unavailable'].includes(view.state)) status.setAttribute('role', 'alert');
    main.append(status);
    if (view.state === 'loading')
      main.append(
        button('Cancel history request', () => {
          review.cancelRead();
        }),
      );
    if (kind === 'usage' && snapshot.usage.state === 'ready')
      main.append(renderUsagePageSummary(root.ownerDocument, snapshot.usage.data));
    // This is the query used by the authorized page, never the mutable drafts.
    // Withhold it with the rows on pending, failed or invalid reads.
    if (view.state === 'ready' || view.state === 'empty') {
      const applied = filters[kind];
      const scope = element('section');
      scope.setAttribute('aria-label', 'Applied history query scope');
      scope.append(element('h3', 'Applied history query scope'));
      const fields = element('dl');
      for (const [label, value] of [
        ['Principal', applied.principalId ?? 'Signed-in principal (self)'],
        ['Model', applied.model ?? 'No model filter'],
        ['Request ID', applied.requestId ?? 'No request filter'],
        [
          'From (inclusive)',
          applied.fromMs === undefined ? 'No lower bound' : formatHistoryTimestamp(applied.fromMs),
        ],
        [
          'To (exclusive)',
          applied.toMs === undefined ? 'No upper bound' : formatHistoryTimestamp(applied.toMs),
        ],
        ['Page size', applied.limit === undefined ? 'Server default' : String(applied.limit)],
      ])
        fields.append(element('dt', label), element('dd', value));
      scope.append(
        fields,
        element(
          'p',
          'Query restrictions only, not effective permissions or complete history. Records and current-page CSV use these filters, not unapplied edits.',
        ),
      );
      main.append(scope);
    }
    const rows = element('ul');
    rows.setAttribute('aria-label', `${kind} records`);
    if (kind === 'usage')
      for (const row of snapshot.usage.data) {
        const item = element('li');
        item.append(
          element(
            'p',
            `${row.principalId} · ${row.modelAlias} · ${row.requestId} · ${formatHistoryTimestamp(row.occurredAt)}`,
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
        item.append(renderUsageRecordDetails(root, row));
        item.append(
          button('View audit for this request', () => {
            // Usage visibility never grants Audit authority. Intersect only
            // the destination applied scope, then perform a fresh read.
            if (!select('audit')) return;
            filters.audit = { ...filters.audit, requestId: row.requestId };
            drafts.audit.clear();
            void workspace.audit.load(filters.audit);
          }),
        );
        item.append(
          button('View usage for this model', () => {
            // Intersect the selected model with applied scope, not row identity
            // or unapplied edits. Existing load resets pagination and CSV.
            filters.usage = { ...filters.usage, model: row.modelAlias };
            drafts.usage.set('model', row.modelAlias);
            void workspace.usage.load(filters.usage);
          }),
        );
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
        const item = renderAuditRecord(root, row);
        item.append(
          button('View usage for this request', () => {
            // Audit visibility does not confer Usage authority. Keep only the
            // applied destination scope and require a fresh authorized read.
            if (!select('usage')) return;
            filters.usage = { ...filters.usage, requestId: row.requestId };
            drafts.usage.clear();
            void workspace.usage.load(filters.usage);
          }),
        );
        rows.append(item);
      }
    main.append(rows);
    if (kind === 'usage' && filters.usage.requestId !== undefined)
      main.append(
        element(
          'p',
          'Request investigation uses the applied Usage scope only. No visible usage is not proof of no provider call or bill; this is not complete history or invoice reconciliation.',
        ),
      );
    if (kind === 'audit' && filters.audit.requestId !== undefined)
      main.append(
        element(
          'p',
          'Request investigation uses the applied Audit scope only. No visible audit is not proof of no decision or complete history.',
        ),
      );
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
    if (view.exportState === 'loading')
      main.append(
        button('Cancel CSV export', () => {
          review.cancelExport();
        }),
      );
    main.append(
      element('p', 'CSV downloads only this page. Exported files cannot be erased on logout.'),
    );
    if (view.exportState !== 'idle' || deliveryFailed[kind]) {
      const message = element(
        'p',
        view.exportState === 'loading'
          ? 'Preparing CSV…'
          : view.exportState === 'cancelled'
            ? 'CSV export cancelled. Download again to retry.'
            : 'CSV unavailable. Try again.',
      );
      message.setAttribute(
        'role',
        ['loading', 'cancelled'].includes(view.exportState) ? 'status' : 'alert',
      );
      main.append(message);
    }
    renderedKind = kind;
    root.replaceChildren(main);
    if (restoreAction) renderedActions.get(restoreAction)?.focus();
    if (restore) {
      const input = renderedInputs.get(restore.field);
      input?.focus();
      if (input && typeof restore.start === 'number' && typeof restore.end === 'number')
        input.setSelectionRange?.(restore.start, restore.end, restore.direction ?? undefined);
    }
  }
  render();
  void workspace.usage.load(filters.usage);
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      clearInputs();
      renderedInputs.clear();
      renderedActions.clear();
      drafts.usage.clear();
      drafts.audit.clear();
      filters.usage = {};
      filters.audit = {};
      workspace.dispose();
      releaseDownload();
      root.replaceChildren();
    },
  });
}
