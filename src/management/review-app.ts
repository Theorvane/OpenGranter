import { type AuditReviewSnapshot, createAuditReview } from './audit-review.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import { createUsageReview, type UsageReviewSnapshot } from './usage-review.ts';

/** Trusted host owns authentication and must dispose before identity/expiry changes.
 * No automatic request, global grant, storage, entry activation or download is added.
 */
export function mountSsoUsageReview(
  root: CatalogElement,
  request: CatalogRequest,
  onCsv?: (csv: string) => void,
) {
  return mount(root, request, 'usage', onCsv);
}
export function mountSsoAuditReview(
  root: CatalogElement,
  request: CatalogRequest,
  onCsv?: (csv: string) => void,
) {
  return mount(root, request, 'audit', onCsv);
}

function mount(
  root: CatalogElement,
  request: CatalogRequest,
  kind: 'usage' | 'audit',
  onCsv?: (csv: string) => void,
) {
  let disposed = false;
  let model = '';
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const review =
    kind === 'usage' ? createUsageReview(request, render) : createAuditReview(request, render);
  function render(value: UsageReviewSnapshot | AuditReviewSnapshot) {
    if (disposed) return;
    const main = element('section');
    main.setAttribute('aria-label', kind === 'usage' ? 'Usage history' : 'Audit history');
    main.setAttribute('aria-busy', String(value.state === 'loading'));
    main.append(element('h2', kind === 'usage' ? 'Usage history' : 'Audit history'));
    const message = element(
      'p',
      {
        idle: 'Choose filters and load history.',
        loading: 'Loading history…',
        ready: 'History loaded.',
        empty: 'No history found.',
        invalid_query: 'Invalid filters.',
        unauthenticated: 'Sign-in required.',
        denied: 'Access denied.',
        unavailable: 'History unavailable. Try again.',
        cancelled: 'Request cancelled.',
      }[value.state],
    );
    message.setAttribute('role', value.state === 'unavailable' ? 'alert' : 'status');
    main.append(message);
    const blocked = value.state === 'unauthenticated' || value.state === 'denied';
    const busy = value.state === 'loading';
    const button = (title: string, disabled: boolean, action: () => void) => {
      const node = element('button', title);
      node.setAttribute('type', 'button');
      if (disabled) node.setAttribute('disabled', '');
      node.addEventListener('click', () => {
        if (!disposed && !disabled) action();
      });
      return node;
    };
    if (!blocked) {
      const label = element('label', 'Model filter');
      const input = element('input');
      input.setAttribute('type', 'text');
      input.setAttribute('maxlength', '256');
      input.value = model;
      label.append(input);
      main.append(
        label,
        button('Load history', busy, () => {
          model = input.value ?? '';
          void review.load(model ? { model } : {});
        }),
      );
    }
    if (value.state === 'ready') {
      const table = element('table');
      const caption = element('caption', 'Current history page');
      const head = element('thead');
      const headings = element('tr');
      const columns =
        kind === 'usage'
          ? [
              'Request',
              'Model',
              'Time (ms)',
              'Outcome',
              'Estimated cost',
              'Reported cost',
              'Comparison',
              'Possible duplicate',
            ]
          : ['Event', 'Request', 'Time (ms)', 'Kind'];
      for (const name of columns) {
        const cell = element('th', name);
        cell.setAttribute('scope', 'col');
        headings.append(cell);
      }
      head.append(headings);
      const body = element('tbody');
      for (const row of value.data) {
        const tr = element('tr');
        const cells =
          'usage' in row
            ? [
                row.requestId,
                row.modelAlias,
                row.occurredAt,
                row.outcome,
                row.estimatedCost
                  ? `${row.estimatedCost.amountDecimal} ${row.estimatedCost.currency}`
                  : 'Unknown',
                row.upstreamBilledCost
                  ? `${row.upstreamBilledCost.amountDecimal} ${row.upstreamBilledCost.currency}`
                  : 'Unknown',
                row.costComparison.status,
                row.possibleDuplicate ? 'Yes' : 'No',
              ]
            : [row.eventId, row.requestId, row.occurredAt, row.kind];
        for (const cell of cells) tr.append(element('td', String(cell)));
        body.append(tr);
      }
      table.append(caption, head, body);
      main.append(table);
    }
    main.append(
      button('Previous page', !value.canPrevious, () => {
        void review.previous();
      }),
      button('Next page', !value.canNext, () => {
        void review.next();
      }),
    );
    if (!blocked && !busy && value.state !== 'idle') {
      main.append(
        button('Retry', false, () => {
          void review.retry();
        }),
      );
    }
    if (onCsv)
      main.append(
        button(
          'Export current page CSV',
          (value.state !== 'ready' && value.state !== 'empty') || value.exportState === 'loading',
          () => {
            void review.exportCsv().then((result) => {
              if (!disposed && result.state === 'ready') {
                try {
                  onCsv(result.csv);
                } catch {
                  /* Host download errors cannot expose data. */
                }
              }
            });
          },
        ),
      );
    // CSV bytes are returned to the trusted host, never rendered or auto-downloaded.
    const exportStatus = element('p', `CSV: ${value.exportState}`);
    exportStatus.setAttribute('role', 'status');
    main.append(exportStatus);
    root.replaceChildren(main);
  }
  render(review.snapshot());
  return {
    snapshot: review.snapshot,
    load: review.load,
    next: review.next,
    previous: review.previous,
    retry: review.retry,
    exportCsv: review.exportCsv,
    dispose() {
      disposed = true;
      review.dispose();
      root.replaceChildren();
    },
  };
}
