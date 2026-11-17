import type { CatalogRequest } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';
import { issueManagementToken, validIssuance } from './token-issue-client.ts';

/** Caller MUST dispose on logout, expiry, or identity change. Clearing is not revocation. */
export function mountTokenIssuancePanel(root: CatalogElement, request: CatalogRequest) {
  let generation = 0;
  let stopped = false;
  let locked = false;
  let pending: AbortController | undefined;
  let clearSecrets = () => {};
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label: string, action: () => void) => {
    const node = element('button', label);
    node.setAttribute('type', 'button');
    node.addEventListener('click', action);
    return node;
  };
  function render(message = 'Issue a proxy token. The server enforces permission and lifetime.') {
    if (stopped) return;
    clearSecrets();
    clearSecrets = () => {};
    const turn = ++generation;
    const current = () => !stopped && !locked && !pending && generation === turn;
    const section = element('section');
    section.setAttribute('aria-label', 'Proxy-token issuance');
    const status = element('p', message);
    status.setAttribute('role', locked ? 'alert' : 'status');
    section.append(element('h2', 'Issue proxy token'), status);
    if (!locked) {
      const principalLabel = element('label', 'Principal ID');
      const principal = element('input');
      principal.setAttribute('type', 'text');
      principal.setAttribute('autocomplete', 'off');
      principal.setAttribute('maxlength', '256');
      principalLabel.append(principal);
      const expiryLabel = element('label', 'Expiry (Unix milliseconds, integer)');
      const expiry = element('input');
      expiry.setAttribute('type', 'text');
      expiry.setAttribute('inputmode', 'numeric');
      expiry.setAttribute('autocomplete', 'off');
      expiry.setAttribute('maxlength', '16');
      expiryLabel.append(expiry);
      section.append(
        principalLabel,
        expiryLabel,
        button('Review issuance', () => {
          if (!current()) return;
          const principalId = principal.value ?? '';
          const rawExpiry = expiry.value ?? '';
          const expiresAt = Number(rawExpiry);
          if (!/^(?:0|[1-9][0-9]*)$/u.test(rawExpiry) || !validIssuance(principalId, expiresAt)) {
            render('Enter a valid principal ID and integer expiry in Unix milliseconds.');
            return;
          }
          principal.value = '';
          expiry.value = '';
          const reviewTurn = ++generation;
          const active = () => !stopped && !locked && !pending && generation === reviewTurn;
          const confirm = button('Confirm issuance', () => {
            if (!active()) return;
            const controller = new AbortController();
            pending = controller;
            ++generation;
            const waiting = element('p', 'Issuance in progress.');
            waiting.setAttribute('role', 'status');
            root.replaceChildren(waiting);
            void issueManagementToken(request, principalId, expiresAt, controller.signal).then(
              (result) => {
                if (stopped || pending !== controller) return;
                pending = undefined;
                if (result.state === 'ready') {
                  const resultTurn = ++generation;
                  const credential = element('pre', result.credentialId);
                  const secret = element('pre', result.token);
                  clearSecrets = () => {
                    credential.textContent = '';
                    secret.textContent = '';
                  };
                  const clear = button('Clear issued token', () => {
                    if (!stopped && generation === resultTurn)
                      render('Display cleared. This does not revoke the issued token.');
                  });
                  root.replaceChildren(
                    element(
                      'p',
                      'Token issued. Save securely now; this panel cannot reveal it again after clearing.',
                    ),
                    element('h3', 'Credential ID'),
                    credential,
                    element('h3', 'Bearer token (secret)'),
                    secret,
                    clear,
                  );
                  clear.focus();
                } else if (result.state === 'unauthenticated' || result.state === 'denied') {
                  locked = true;
                  render(
                    result.state === 'unauthenticated'
                      ? 'Sign in again before managing tokens.'
                      : 'Token management access denied.',
                  );
                } else {
                  render(
                    result.state === 'invalid_input'
                      ? 'Issuance rejected. Check principal ID, expiry and server lifetime rules.'
                      : 'Issuance outcome is unknown. A token may have been issued. Verify before submitting another request.',
                  );
                }
              },
            );
          });
          const warning = element(
            'p',
            `Confirm issuance for principal ID: ${principalId}; expiry (Unix milliseconds): ${expiresAt}. The bearer secret will be displayed once.`,
          );
          warning.setAttribute('role', 'alert');
          root.replaceChildren(
            warning,
            confirm,
            button('Cancel', () => {
              if (active()) render();
            }),
          );
          confirm.focus();
        }),
      );
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
      clearSecrets();
      clearSecrets = () => {};
      root.replaceChildren();
    },
  };
}
