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
  const delivery: Record<Kind, 'idle' | 'started' | 'failed'> = { usage: 'idle', audit: 'idle' };
  // Preserve the exact target. Existing clients reject invalid history IDs
  // locally; never silently fall back to a self/unfiltered request.
  const initial = initialPrincipalId === undefined ? {} : { principalId: initialPrincipalId };
  const filters: Record<Kind, AuditFilters> = { usage: { ...initial }, audit: { ...initial } };
  const retainedInputs = new Set<CatalogElement>();
  let renderedKind: Kind = active;
  const renderedInputs = new Map<keyof AuditFilters, HistoryInput>();
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
    // Cancel before selecting: cancellation notifications must not render a
    // cached destination page before its fresh authorization request starts.
    // Review revisions also suppress late headers/bodies and CSV delivery.
    if (previous !== kind) workspace[previous].cancel();
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
    const current = generation;
    node.addEventListener('click', (event) => {
      if (submit) event?.preventDefault();
      if (enabled && current === generation && available()) action();
    });
    return node;
  }
  async function exportCsv(kind: Kind) {
    delivery[kind] = 'idle';
    const result = await workspace[kind].exportCsv();
    if (!available() || result.state !== 'ready') return;
    const deliveryGeneration = generation;
    let started = false;
    try {
      started = download.save(kind, result.csv) === 'started';
    } catch {
      /* Render only the same generic, retryable delivery failure. */
    }
    // A browser adapter may synchronously navigate or dispose the identity epoch.
    if (!available() || generation !== deliveryGeneration) return;
    delivery[kind] = started ? 'started' : 'failed';
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
    for (const tab of ['usage', 'audit'] as const) {
      const page = snapshot[tab];
      if ((page.state !== 'ready' && page.state !== 'empty') || page.exportState === 'loading')
        delivery[tab] = 'idle';
    }
    const kind = active;
    const review = workspace[kind];
    const view = snapshot[kind];
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
      const edited = [...values].some(
        ([field, node]) => (node.value ?? '') !== String(filters[kind][field] ?? ''),
      );
      draftStatus.textContent = edited
        ? 'Unapplied filter edits. Records, pagination and CSV still use the applied filters.'
        : '';
    }
    const inputGeneration = generation;
    for (const [field, name] of [
      ['principalId', 'Principal'],
      ['model', 'Model'],
      ['fromMs', 'From (Unix ms, inclusive)'],
      ['toMs', 'To (Unix ms, exclusive)'],
      ['requestId', 'Request ID'],
      ['limit', 'Page size (1–100, blank for default)'],
    ] as const) {
      const label = element('label', name);
      const input = element('input');
      input.setAttribute('type', 'text');
      input.setAttribute('aria-label', name);
      input.value = drafts[kind].get(field) ?? String(filters[kind][field] ?? '');
      retainedInputs.add(input);
      renderedInputs.set(field, input);
      label.append(input);
      controls.append(label);
      values.set(field, input);
      input.addEventListener('input', () => {
        if (inputGeneration !== generation || !available()) return;
        drafts[kind].set(field, input.value ?? '');
        updateDraftStatus();
      });
    }
    updateDraftStatus();
    controls.append(draftStatus);
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
          input[field] = /^(0|[1-9][0-9]*)$/u.test(value) ? Number(value) : Number.NaN;
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
      button('Reset filters', () => {
        // Restore the mount target rather than broadening an account deep link.
        // load() owns stale JSON/CSV cancellation and resets the cursor path.
        filters[kind] = { ...initial };
        drafts[kind].clear();
        delivery[kind] = 'idle';
        void review.load(filters[kind]);
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
        item.append(renderUsageRecordDetails(root, row));
        item.append(
          button('View audit for this request', () => {
            // Usage visibility is not Audit authority. Preserve only the
            // destination applied scope; never copy the Usage principal.
            if (!select('audit')) return;
            filters.audit = { ...filters.audit, requestId: row.requestId };
            drafts.audit.clear();
            void workspace.audit.load(filters.audit);
          }),
        );
        item.append(
          button('View attempts for this request', () => {
            // Exact intersection, not an organization-wide lookup. Clear the
            // opaque cursor by loading afresh; retain applied time/model bounds.
            filters.usage = { ...filters.usage, requestId: row.requestId };
            drafts.usage.clear();
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
            // Audit visibility is not Usage authority. Intersect only the
            // existing applied Usage scope; never copy the Audit target.
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
          'Request investigation uses the applied Audit scope only. No visible records is not complete audit history or proof that a request was never executed.',
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
    if (view.state === 'loading')
      main.append(button('Cancel history request', () => review.cancel()));
    if (view.exportState === 'loading')
      main.append(button('Cancel CSV preparation', () => review.cancel()));
    main.append(
      element('p', 'Cancel stops local waiting only; server work and audit may still complete.'),
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
    if (view.exportState !== 'idle' || delivery[kind] !== 'idle') {
      const message = element(
        'p',
        view.exportState === 'loading'
          ? 'Preparing CSV…'
          : view.exportState === 'cancelled'
            ? 'CSV preparation cancelled. Download again to retry.'
            : delivery[kind] === 'started'
              ? 'CSV download requested. Check your browser; file save is not confirmed.'
              : 'CSV unavailable. Try again.',
      );
      message.setAttribute(
        'role',
        view.exportState === 'loading' || delivery[kind] === 'started' ? 'status' : 'alert',
      );
      main.append(message);
    }
    renderedKind = kind;
    root.replaceChildren(main);
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
