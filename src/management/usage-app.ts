import { mountManagementBoundaryView } from './boundary-view.ts';
import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import { createSsoUsageSession, type UsageSearch } from './usage-session.ts';

/** Read-only DOM composition, not an authenticator. Trusted host must clear on
 * logout, expiry and identity change; no credentials, storage or timers here. */
export function mountSsoUsageReview(root: CatalogElement) {
  const session = createSsoUsageSession();
  let filters: UsageSearch = {};
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
  async function run(operation: () => Promise<void>) {
    const pending = operation();
    render();
    await pending;
    render();
  }
  async function search(query: UsageSearch = {}) {
    filters = {
      ...(query.principalId !== undefined ? { principalId: query.principalId } : {}),
      ...(query.model !== undefined ? { model: query.model } : {}),
      ...(query.fromMs !== undefined ? { fromMs: query.fromMs } : {}),
      ...(query.toMs !== undefined ? { toMs: query.toMs } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    };
    await run(() => session.search(filters));
  }
  function render() {
    const snapshot = session.snapshot();
    if (snapshot.state === 'disposed') {
      root.replaceChildren();
      return;
    }
    if (
      snapshot.state === 'unauthenticated' ||
      snapshot.state === 'expired' ||
      snapshot.state === 'denied'
    ) {
      filters = {};
      mountManagementBoundaryView(root, snapshot.state);
      return;
    }
    const main = element('main');
    main.append(element('h1', 'Usage review'));
    const message = element('p');
    message.setAttribute(
      'role',
      snapshot.state === 'invalid_query' || snapshot.state === 'unavailable' ? 'alert' : 'status',
    );
    message.textContent =
      snapshot.state === 'loading'
        ? 'Loading usage…'
        : snapshot.state === 'empty'
          ? 'No usage records.'
          : snapshot.state === 'invalid_query'
            ? 'Invalid usage filters.'
            : snapshot.state === 'unavailable'
              ? 'Usage unavailable. Try a new search.'
              : snapshot.state === 'idle'
                ? 'Choose filters and search usage.'
                : 'Usage page loaded.';
    main.append(message);
    if (snapshot.state === 'loading') {
      root.replaceChildren(main);
      return;
    }
    const controls = element('section');
    controls.setAttribute('aria-label', 'Usage filters');
    const input = (label: string, value: string) => {
      const wrapper = element('label', label);
      const field = element('input');
      field.setAttribute('type', 'text');
      field.setAttribute('aria-label', label);
      field.value = value;
      wrapper.append(field);
      controls.append(wrapper);
      return field;
    };
    const principal = input('Principal', filters.principalId ?? '');
    const model = input('Model', filters.model ?? '');
    const from = input('From (epoch ms)', filters.fromMs?.toString() ?? '');
    const to = input('To (epoch ms)', filters.toMs?.toString() ?? '');
    const limit = input('Page size', filters.limit?.toString() ?? '');
    const numeric = (field: CatalogElement) => {
      const value = field.value?.trim() ?? '';
      return value === '' ? undefined : Number(value);
    };
    controls.append(
      button('Search usage', () => {
        const fromMs = numeric(from);
        const toMs = numeric(to);
        const pageSize = numeric(limit);
        void search({
          ...(principal.value ? { principalId: principal.value } : {}),
          ...(model.value ? { model: model.value } : {}),
          ...(fromMs !== undefined ? { fromMs } : {}),
          ...(toMs !== undefined ? { toMs } : {}),
          ...(pageSize !== undefined ? { limit: pageSize } : {}),
        });
      }),
    );
    main.append(controls);
    if (snapshot.state === 'rows') {
      const table = element('table');
      table.append(element('caption', 'Authorized usage records; unknown values are not zero.'));
      const head = element('thead');
      const headers = element('tr');
      for (const label of [
        'Time (epoch ms)',
        'Principal',
        'Model',
        'Attempt',
        'Outcome',
        'Tokens',
        'Costs',
        'Reconciliation',
      ]) {
        const th = element('th', label);
        th.setAttribute('scope', 'col');
        headers.append(th);
      }
      head.append(headers);
      const body = element('tbody');
      for (const row of snapshot.data) {
        const tr = element('tr');
        const tokens = row.usage;
        const tokenText =
          tokens.totalTokens === null ? 'Tokens: Unknown' : `Tokens: ${tokens.totalTokens}`;
        const counts =
          tokenText +
          '; prompt: ' +
          (tokens.promptTokens ?? 'Unknown') +
          '; completion: ' +
          (tokens.completionTokens ?? 'Unknown') +
          '; status: ' +
          tokens.status;
        const estimated = row.estimatedCost
          ? row.estimatedCost.amountDecimal +
            ' ' +
            row.estimatedCost.currency +
            ' (price ' +
            row.estimatedCost.priceVersion +
            ')'
          : 'Unknown';
        const billed = row.upstreamBilledCost
          ? row.upstreamBilledCost.amountDecimal +
            ' ' +
            row.upstreamBilledCost.currency +
            ' (' +
            row.upstreamBilledCost.source +
            ')'
          : 'Unknown';
        const markers = [
          row.possibleDuplicate ? 'Possible duplicate' : 'No duplicate flagged',
          row.possiblyBilled ? 'Possibly billed' : 'Not flagged as possibly billed',
        ].join('; ');
        for (const text of [
          String(row.occurredAt),
          row.principalId,
          row.modelAlias,
          row.attemptId,
          row.outcome,
          counts,
          `Estimated: ${estimated}; Reported: ${billed}`,
          markers,
        ])
          tr.append(element('td', text));
        body.append(tr);
      }
      table.append(head, body);
      main.append(table);
      if (snapshot.hasMore)
        main.append(
          button('Next page', () => {
            void run(() => session.next());
          }),
        );
    }
    root.replaceChildren(main);
  }
  render();
  return {
    authorize(request: CatalogRequest) {
      filters = {};
      session.authorize(request);
      render();
    },
    search,
    clear(reason: 'unauthenticated' | 'expired' | 'denied' | 'unavailable') {
      filters = {};
      session.clear(reason);
      render();
    },
    dispose() {
      filters = {};
      session.dispose();
      render();
    },
  };
}
