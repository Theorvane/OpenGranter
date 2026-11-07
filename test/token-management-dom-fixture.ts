import assert from 'node:assert/strict';
import type { UsageElement } from '../src/management/usage-app.ts';

export class TokenElement implements UsageElement {
  textContent: string | null = null;
  value = '';
  children: TokenElement[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, (event?: { preventDefault(): void }) => void> = {};
  ownerDocument = { createElement: (tag: string) => new TokenElement(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  append(...nodes: TokenElement[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: TokenElement[]) {
    this.children = nodes;
  }
  addEventListener(type: string, listener: (event?: { preventDefault(): void }) => void) {
    this.listeners[type] = listener;
  }
  focus() {}
  all(): TokenElement[] {
    return [this, ...this.children.flatMap((node) => node.all())];
  }
  text() {
    return this.all()
      .map((node) => node.textContent ?? '')
      .join(' ');
  }
  named(name: string) {
    const n = this.all().find((node) => node.attrs.name === name);
    assert.ok(n, name);
    return n;
  }
  button(name: string) {
    const n = this.all().find((node) => node.tag === 'button' && node.textContent === name);
    assert.ok(n, name);
    return n;
  }
  click() {
    this.listeners.click?.();
  }
  submit() {
    this.listeners.submit?.({ preventDefault() {} });
  }
}
