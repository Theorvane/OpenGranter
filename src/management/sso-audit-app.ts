import type { CatalogAuthorityGrant } from './catalog-authority.ts';
import type { SsoAuditFilters } from './sso-audit-client.ts';
import {
  createManagementSsoAuditWorkspace,
  type SsoAuditWorkspaceOptions,
  type SsoAuditWorkspaceSnapshot,
} from './sso-audit-workspace.ts';
import type { UsageElement } from './usage-app.ts';
import { formatUsageTime, parseUsageUtcInput } from './usage-time.ts';

/** Trusted mounted view only: current principal is supplied by the bounded /me reader.
 * Identity is not permission; every list/export is authorized again by the server.
 * CSV is displayed as text, page-scoped, and erased on teardown; no persistent URL.
 */
export function mountManagementAudit(root: UsageElement, options: SsoAuditWorkspaceOptions = {}) {
  let disposed = false;
  let revision = 0;
  let drafts: Record<string, string> = {};
  const workspace = createManagementSsoAuditWorkspace({ ...options, onChange: render });
  function render(snapshot: SsoAuditWorkspaceSnapshot) {
    if (disposed) return;
    const current = ++revision;
    if (['unauthenticated', 'expired', 'denied', 'disposed'].includes(snapshot.state)) drafts = {};
    const element = (tag: string, text?: string) => {
      const node = root.ownerDocument.createElement(tag);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (text: string, enabled: boolean, action: () => void) => {
      const node = element('button', text);
      node.setAttribute('type', 'button');
      if (!enabled) node.setAttribute('disabled', '');
      node.addEventListener('click', () => {
        if (!disposed && current === revision && enabled) action();
      });
      return node;
    };
    const main = element('section');
    main.append(element('h1', 'Audit history'));
    const messages: Record<SsoAuditWorkspaceSnapshot['state'], string> = {
      unauthenticated: 'Sign-in required.',
      expired: 'Session expired.',
      denied: 'Access denied.',
      disposed: '',
      idle: 'Audit ready.',
      loading: 'Loading audit…',
      ready: 'Audit events loaded.',
      empty: 'No audit events.',
      exporting: 'Exporting audit…',
      invalid_query: 'Invalid audit filters.',
      unavailable: 'Audit unavailable.',
      cancelled: 'Audit cancelled.',
    };
    const status = element('p', messages[snapshot.state]);
    status.setAttribute('role', 'status');
    main.append(status);
    const authorized = !['unauthenticated', 'expired', 'denied', 'disposed'].includes(
      snapshot.state,
    );
    const busy = snapshot.state === 'loading' || snapshot.state === 'exporting';
    if (authorized) {
      const form = element('form');
      form.setAttribute('name', 'audit-filters');
      const inputs: Record<string, UsageElement> = {};
      for (const [name, label, type] of [
        ['principalId', 'Principal (requires scoped server permission)', 'text'],
        ['model', 'Model', 'text'],
        ['from', 'From UTC (inclusive)', 'datetime-local'],
        ['to', 'To UTC (exclusive)', 'datetime-local'],
      ] as const) {
        const wrapper = element('label', label);
        const input = element('input');
        input.setAttribute('name', name);
        input.setAttribute('type', type);
        if (type === 'datetime-local') input.setAttribute('step', '0.001');
        input.value = drafts[name] ?? '';
        inputs[name] = input;
        wrapper.append(input);
        form.append(wrapper);
      }
      const submit = element('button', 'Apply audit filters');
      submit.setAttribute('type', 'submit');
      if (busy) submit.setAttribute('disabled', '');
      form.append(submit);
      form.addEventListener('submit', (event) => {
        event?.preventDefault();
        if (disposed || current !== revision || busy) return;
        drafts = Object.fromEntries(
          Object.entries(inputs).map(([key, input]) => [key, input.value ?? '']),
        );
        const filters: SsoAuditFilters = {
          ...(drafts.principalId ? { principalId: drafts.principalId } : {}),
          ...(drafts.model ? { model: drafts.model } : {}),
          ...(drafts.from ? { fromMs: parseUsageUtcInput(drafts.from) } : {}),
          ...(drafts.to ? { toMs: parseUsageUtcInput(drafts.to) } : {}),
        };
        void workspace.load(filters);
      });
      main.append(form);
      if (snapshot.page) {
        const table = element('table');
        const header = element('tr');
        for (const text of ['Time UTC', 'Event', 'Principal', 'Request', 'Details'])
          header.append(element('th', text));
        const head = element('thead');
        head.append(header);
        const body = element('tbody');
        for (const event of snapshot.page.events) {
          const row = element('tr');
          for (const text of [
            formatUsageTime(event.occurredAt),
            event.kind,
            event.principalId,
            event.requestId,
            JSON.stringify(event.details),
          ])
            row.append(element('td', text));
          body.append(row);
        }
        table.append(head, body);
        main.append(table);
      }
      main.append(
        button('Previous page', snapshot.canPrevious, () => {
          void workspace.previous();
        }),
        button('Next page', snapshot.canNext, () => {
          void workspace.next();
        }),
        button('Export current page CSV', !!snapshot.page && !busy, () => {
          void workspace.exportCsv();
        }),
      );
      if (snapshot.csv) {
        main.append(
          element(
            'p',
            snapshot.csv.hasMore
              ? 'CSV contains this page only; more pages remain.'
              : 'CSV contains this page only.',
          ),
          element('pre', snapshot.csv.csv),
        );
      }
    }
    root.replaceChildren(main);
  }
  render(workspace.snapshot());
  return {
    async authorize(grant: CatalogAuthorityGrant & { readonly principalId: string }) {
      if (disposed) return;
      drafts = {};
      workspace.authorize(grant);
      await workspace.load();
    },
    clear(reason: 'unauthenticated' | 'expired' | 'denied' = 'unauthenticated') {
      if (!disposed) workspace.clear(reason);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      drafts = {};
      workspace.dispose();
      root.replaceChildren();
    },
  };
}
