import { mountManagementBoundaryView } from './boundary-view.ts';
import type { ManagementCatalogSnapshot } from './catalog-session.ts';

export interface CatalogElement {
  textContent: string | null;
  ownerDocument: { createElement(tag: string): CatalogElement };
  setAttribute(name: string, value: string): void;
  append(...nodes: CatalogElement[]): void;
  replaceChildren(...nodes: CatalogElement[]): void;
  addEventListener(type: string, listener: () => void): void;
  focus(): void;
}
export type CatalogViewState = ManagementCatalogSnapshot;
export interface CatalogActions {
  list(): void;
  detail(alias: string): void;
}

/** Native buttons preserve keyboard activation; untrusted values enter textContent only. */
export function renderCatalogView(
  root: CatalogElement,
  value: CatalogViewState,
  actions: CatalogActions,
  moveFocus = false,
): void {
  if (value.state === 'disposed') {
    root.replaceChildren();
    return;
  }
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text: string, click: () => void) => {
    const node = element('button', text);
    node.setAttribute('type', 'button');
    node.addEventListener('click', click);
    return node;
  };
  if (value.state === 'unauthenticated' || value.state === 'expired' || value.state === 'denied') {
    mountManagementBoundaryView(root, value.state);
    return;
  }
  const main = element('main');
  const title = element('h1', 'Models available to your identity');
  title.setAttribute('tabindex', '-1');
  main.append(title);
  if (
    value.state === 'loading' ||
    value.state === 'idle' ||
    value.state === 'unavailable' ||
    value.state === 'missing'
  ) {
    const message = element(
      'p',
      value.state === 'loading' || value.state === 'idle'
        ? 'Loading models…'
        : value.state === 'missing'
          ? 'Model not found.'
          : 'Model catalog unavailable. Try again later.',
    );
    message.setAttribute(
      'role',
      value.state === 'loading' || value.state === 'idle' ? 'status' : 'alert',
    );
    main.append(message);
    if (value.state !== 'loading' && value.state !== 'idle')
      main.append(button('Back to models', actions.list));
  } else if (value.state === 'list' || value.state === 'empty') {
    if (value.state !== 'list' || value.models.length === 0) {
      const empty = element('p', 'No models available to your identity.');
      empty.setAttribute('role', 'status');
      main.append(empty);
    } else {
      const list = element('ul');
      for (const model of value.models) {
        const row = element('li');
        row.append(button(model.id, () => actions.detail(model.id)));
        list.append(row);
      }
      main.append(list);
    }
    main.append(button('Refresh models', actions.list));
  } else if (value.state === 'detail') {
    const model = value.model;
    const details = element('dl');
    for (const [label, text] of [
      ['Model ID', model.id],
      ['Published by', model.owned_by],
      ['Created (Unix seconds)', String(model.created)],
    ]) {
      details.append(element('dt', label), element('dd', text));
    }
    main.append(details, button('Back to models', actions.list));
  }
  root.replaceChildren(main);
  if (moveFocus && value.state !== 'loading' && value.state !== 'idle') title.focus();
}
