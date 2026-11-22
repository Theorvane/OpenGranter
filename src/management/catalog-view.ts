import { mountManagementBoundaryView } from './boundary-view.ts';
import {
  matchesPublication,
  type PublicationField,
  publicationOptions,
} from './catalog-publication-filter.ts';
import type { ManagementCatalogSnapshot } from './catalog-session.ts';
import { renderPublishedModelDetails } from './model-detail-view.ts';

const releaseView = new WeakMap<CatalogElement, () => void>();

export interface CatalogElement {
  textContent: string | null;
  value?: string;
  ownerDocument: { createElement(tag: string): CatalogElement };
  setAttribute(name: string, value: string): void;
  append(...nodes: CatalogElement[]): void;
  replaceChildren(...nodes: CatalogElement[]): void;
  addEventListener(type: string, listener: (event?: { preventDefault(): void }) => void): void;
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
  releaseView.get(root)?.();
  releaseView.delete(root);
  let active = true;
  const controls: CatalogElement[] = [];
  releaseView.set(root, () => {
    active = false;
    for (const control of controls) control.value = '';
  });
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
    node.addEventListener('click', () => {
      if (active) click();
    });
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
      const label = element('label', 'Search models');
      const search = element('input');
      search.setAttribute('type', 'search');
      search.setAttribute('placeholder', 'Model ID, publisher, name or description');
      label.append(search);
      controls.push(search);
      const selection: Record<PublicationField, string> = { input: '', output: '', parameter: '' };
      const selectors: CatalogElement[] = [];
      for (const [field, name] of [
        ['input', 'Published input modality'],
        ['output', 'Published output modality'],
        ['parameter', 'Published supported parameter'],
      ] as const) {
        const wrapper = element('label', name);
        const select = element('select');
        select.setAttribute('aria-label', name);
        const all = element('option', 'Any (including unpublished)');
        all.setAttribute('value', '');
        select.append(all);
        for (const option of publicationOptions(value.models, field)) {
          const item = element('option', option);
          item.setAttribute('value', option);
          select.append(item);
        }
        select.value = '';
        select.addEventListener('change', () => {
          if (!active) return;
          selection[field] = select.value ?? '';
          filter();
        });
        controls.push(select);
        wrapper.append(select);
        selectors.push(wrapper);
      }
      const list = element('ul');
      const status = element('p');
      status.setAttribute('role', 'status');
      let generation = 0;
      const filter = () => {
        if (!active) return;
        const current = ++generation;
        const query = (search.value ?? '').trim().toLowerCase();
        const models = value.models.filter(
          (model) =>
            matchesPublication(model, selection) &&
            [model.id, model.owned_by, model.name, model.description].some((text) =>
              text?.toLowerCase().includes(query),
            ),
        );
        list.replaceChildren();
        for (const model of models) {
          const row = element('li');
          row.append(
            button(model.id, () => {
              if (generation === current) actions.detail(model.id);
            }),
          );
          if (model.name !== undefined) row.append(element('p', model.name));
          if (model.description !== undefined) {
            const description = element(
              'p',
              model.description === '' ? 'Empty description' : model.description,
            );
            description.setAttribute('class', 'management-model-description');
            row.append(description);
          }
          list.append(row);
        }
        status.textContent = models.length
          ? `${models.length} models shown.`
          : 'No matching models.';
      };
      search.addEventListener('input', filter);
      filter();
      main.append(
        label,
        ...selectors,
        element(
          'p',
          'Filters inspect this authorized publication only, not live provider capability or permission to execute.',
        ),
        status,
        list,
      );
    }
    main.append(button('Refresh models', actions.list));
  } else if (value.state === 'detail') {
    const model = value.model;
    main.append(
      ...renderPublishedModelDetails(root, model),
      button('Back to models', actions.list),
    );
  }
  root.replaceChildren(main);
  if (moveFocus && value.state !== 'loading' && value.state !== 'idle') title.focus();
}
