import type { createManagementTokenWorkspace } from './token-management-workspace.ts';
import type { UsageElement } from './usage-app.ts';

type Workspace = ReturnType<typeof createManagementTokenWorkspace>;
const messages: Readonly<Record<string, string>> = {
  issued: 'Token issued. Copy the one-time secret before hiding or leaving this screen.',
  revoked: 'Token revoked.',
  not_revoked: 'Token was not revoked. No success is inferred.',
  invalid_input:
    'Enter a principal and an integer expiry (epoch milliseconds), or a credential ID.',
  invalid_request: 'The server rejected the request.',
  invalid_credential: 'Enter a credential ID to review revocation.',
  unauthenticated: 'Authentication required.',
  denied: 'Access denied.',
  outcome_unknown: 'Reconciliation required. The operation may have committed. Do not retry.',
  reconciliation_required: 'Reconciliation required. Do not retry or reset this workspace.',
  expired: 'Authority expired. Authenticate through the approved host.',
  disposed: 'Authentication required.',
  busy: 'Working. Do not retry.',
};

/** Host owns ONE workspace across navigation, logout and new grants.
 * This screen neither acquires authority nor resets an ambiguous mutation.
 * Unmount hides secrets/aborts pending work, but never destroys the host latch.
 */
export function mountManagementTokens(root: UsageElement, workspace: Workspace) {
  let disposed = false;
  let revision = 0;
  let outcome = '';
  let principal = '';
  let expiry = '';
  let credential = '';
  let pendingRevocation: string | undefined;
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function render() {
    if (disposed) return;
    // snapshot may expire authority and synchronously notify; use the final revision.
    const snapshot = workspace.snapshot();
    const rendered = ++revision;
    const section = element('section');
    section.setAttribute('aria-label', 'Proxy token administration');
    section.append(element('h2', 'Proxy tokens'));
    const status = element('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const state = snapshot.reconciliationRequired
      ? 'reconciliation_required'
      : snapshot.busy
        ? 'busy'
        : snapshot.state;
    status.textContent =
      state === 'ready'
        ? (messages[outcome] ?? 'Ready. No token has been issued by this screen.')
        : (messages[
            state === 'disposed' && (outcome === 'denied' || outcome === 'unauthenticated')
              ? outcome
              : state
          ] ?? 'Authentication required.');
    section.append(status);
    const allowed = () => {
      if (disposed || revision !== rendered) return false;
      const current = workspace.snapshot();
      // Snapshot can trigger a synchronous expiry rerender.
      return (
        revision === rendered &&
        current.state === 'ready' &&
        !current.busy &&
        !current.reconciliationRequired
      );
    };
    const input = (form: UsageElement, name: string, title: string, value: string) => {
      const label = element('label', title);
      const node = element('input');
      node.setAttribute('name', name);
      node.setAttribute('type', 'text');
      node.setAttribute('autocomplete', 'off');
      node.setAttribute('required', '');
      node.value = value;
      label.append(node);
      form.append(label);
      return node;
    };
    const submit = (form: UsageElement, title: string, action: () => void) => {
      const button = element('button', title);
      button.setAttribute('type', 'submit');
      if (state !== 'ready') button.setAttribute('disabled', '');
      form.append(button);
      form.addEventListener('submit', (event) => {
        event?.preventDefault();
        if (allowed()) action();
      });
    };
    const issue = element('form');
    issue.setAttribute('name', 'issue');
    const principalInput = input(issue, 'principalId', 'Principal ID', principal);
    const expiryInput = input(issue, 'expiresAt', 'Expiry (epoch milliseconds)', expiry);
    const complete = async (
      epoch: number,
      pending: ReturnType<Workspace['issue']> | ReturnType<Workspace['revoke']>,
    ) => {
      const result = await pending;
      if (disposed) return;
      // Never show a stale success over expiry/logout/grant replacement.
      const current = workspace.snapshot();
      if (current.authorityRevision !== epoch) {
        render();
        return;
      }
      if (
        current.state === 'ready' ||
        result.state === 'denied' ||
        result.state === 'unauthenticated'
      ) {
        outcome = result.state === 'revoked' && !result.revoked ? 'not_revoked' : result.state;
      }
      render();
    };
    submit(issue, 'Issue token', () => {
      pendingRevocation = undefined;
      principal = principalInput.value ?? '';
      expiry = expiryInput.value ?? '';
      if (!principal || !/^\d+$/u.test(expiry) || !Number.isSafeInteger(Number(expiry))) {
        outcome = 'invalid_input';
        render();
        return;
      }
      outcome = '';
      void complete(
        snapshot.authorityRevision,
        workspace.issue({ principalId: principal, expiresAt: Number(expiry) }),
      );
    });
    section.append(issue);
    const revoke = element('form');
    revoke.setAttribute('name', 'revoke');
    const credentialInput = input(revoke, 'credentialId', 'Credential ID', credential);
    submit(revoke, 'Revoke token', () => {
      credential = credentialInput.value ?? '';
      pendingRevocation = credential || undefined;
      outcome = credential ? '' : 'invalid_credential';
      render();
    });
    section.append(revoke);
    if (pendingRevocation !== undefined && state === 'ready') {
      // Capture the reviewed ID, not a mutable form input or later authority.
      const target = pendingRevocation;
      const review = element('section');
      review.setAttribute('aria-label', 'Confirm token revocation');
      review.append(
        element('h3', 'Review token revocation'),
        element('p', 'Credential ID to revoke: ' + target),
        element(
          'p',
          'This will request revocation. Existence, ownership and permission are checked by the server, not this review.',
        ),
      );
      const confirm = element('button', 'Confirm revocation');
      confirm.setAttribute('type', 'button');
      confirm.addEventListener('click', () => {
        if (!allowed() || pendingRevocation !== target) return;
        pendingRevocation = undefined;
        outcome = '';
        void complete(snapshot.authorityRevision, workspace.revoke({ credentialId: target }));
      });
      const cancel = element('button', 'Cancel revocation');
      cancel.setAttribute('type', 'button');
      cancel.addEventListener('click', () => {
        if (!allowed() || pendingRevocation !== target) return;
        pendingRevocation = undefined;
        outcome = '';
        render();
      });
      review.append(confirm, cancel);
      section.append(review);
    }
    if (snapshot.secret) {
      section.append(element('p', 'Credential ID: ' + snapshot.secret.credentialId));
      const secret = element('pre', snapshot.secret.token);
      secret.setAttribute('aria-label', 'One-time proxy token secret');
      section.append(secret);
      const hide = element('button', 'Hide secret');
      hide.setAttribute('type', 'button');
      hide.addEventListener('click', () => {
        if (allowed()) {
          outcome = '';
          workspace.hideSecret();
        }
      });
      section.append(hide);
    }
    root.replaceChildren(section);
  }
  let authorityRevision = workspace.snapshot().authorityRevision;
  const unsubscribe = workspace.subscribe(() => {
    pendingRevocation = undefined;
    const current = workspace.snapshot();
    if (current.authorityRevision !== authorityRevision || current.state !== 'ready') {
      principal = '';
      expiry = '';
      credential = '';
    }
    authorityRevision = current.authorityRevision;
    outcome = '';
    render();
  });
  render();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingRevocation = undefined;
      ++revision;
      unsubscribe();
      workspace.hideSecret();
      principal = '';
      expiry = '';
      credential = '';
      outcome = '';
      root.replaceChildren();
    },
  };
}
