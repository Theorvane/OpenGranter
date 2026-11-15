import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import { revokeManagementToken, validCredentialId } from './token-revoke-client.ts';

/** Explicit confirmation only; caller MUST dispose on any identity change. */
export function mountTokenRevocationPanel(root: CatalogElement, request: CatalogRequest) {
  let generation = 0;
  let stopped = false;
  let locked = false;
  let pending: AbortController | undefined;
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function render(
    message = 'Revoke a proxy token using its credential ID, not its bearer secret.',
  ) {
    if (stopped) return;
    const turn = ++generation;
    const current = () => !stopped && !locked && !pending && generation === turn;
    const section = element('section');
    section.setAttribute('aria-label', 'Proxy-token revocation');
    const status = element('p', message);
    status.setAttribute('role', locked ? 'alert' : 'status');
    section.append(element('h2', 'Revoke proxy token'), status);
    if (!locked) {
      const label = element('label', 'Credential ID');
      const input = element('input');
      input.setAttribute('type', 'text');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('maxlength', '256');
      label.append(input);
      const review = element('button', 'Review revocation');
      review.setAttribute('type', 'button');
      review.addEventListener('click', () => {
        if (!current()) return;
        const id = input.value ?? '';
        if (!validCredentialId(id)) {
          render('Enter a valid credential ID.');
          return;
        }
        input.value = '';
        const confirmTurn = ++generation;
        const active = () => !stopped && !locked && !pending && generation === confirmTurn;
        const warning = element('p', `Confirm revocation for credential ID: ${id}`);
        warning.setAttribute('role', 'alert');
        const confirm = element('button', 'Confirm revocation');
        confirm.setAttribute('type', 'button');
        const cancel = element('button', 'Cancel');
        cancel.setAttribute('type', 'button');
        cancel.addEventListener('click', () => {
          if (active()) render();
        });
        confirm.addEventListener('click', () => {
          if (!active()) return;
          const controller = new AbortController();
          pending = controller;
          ++generation;
          const waiting = element('p', 'Revocation in progress.');
          waiting.setAttribute('role', 'status');
          root.replaceChildren(waiting);
          void revokeManagementToken(request, id, controller.signal).then((result) => {
            if (stopped || pending !== controller) return;
            pending = undefined;
            if (result.state === 'unauthenticated' || result.state === 'denied') {
              locked = true;
              render(
                result.state === 'unauthenticated'
                  ? 'Sign in again before managing tokens.'
                  : 'Token management access denied.',
              );
            } else if (result.state === 'ready') {
              render(
                result.revoked ? 'Token revocation confirmed.' : 'No token revocation reported.',
              );
            } else {
              render(
                'Revocation outcome is unknown. It may have completed. Verify before submitting another request.',
              );
            }
          });
        });
        root.replaceChildren(warning, confirm, cancel);
        confirm.focus();
      });
      section.append(label, review);
    }
    root.replaceChildren(section);
  }
  render();
  return {
    dispose() {
      stopped = true;
      ++generation;
      pending?.abort();
      pending = undefined;
      root.replaceChildren();
    },
  };
}
