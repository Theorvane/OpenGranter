import type { CatalogElement } from '../src/management/catalog-view.ts';
export class Element implements CatalogElement {
  readonly tag: string;
  textContent: string | null = null;
  value = '';
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  focused = false;
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
    this.textContent = null;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {
    this.focused = true;
  }
}
export function nodes(root: Element): Element[] {
  return [root, ...root.children.flatMap(nodes)];
}
export function text(root: Element): string {
  return nodes(root)
    .map((node) => node.textContent ?? '')
    .join(' ');
}
