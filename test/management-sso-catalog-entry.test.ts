import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildManagementBrowser } from '../scripts/build-management-browser.ts';

class Element {
  textContent: string | null = null;
  children: Element[] = [];
  ownerDocument = { createElement: () => new Element() };
  setAttribute() {}
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  addEventListener() {}
  focus() {}
  text(): string {
    return [this.textContent ?? '', ...this.children.map((n) => n.text())].join(' ');
  }
}

test('actual SSO public entry stays signed out across page lifecycle without ambient authority', async () => {
  const javascript = await buildManagementBrowser({
    root: resolve('.'),
    entry: 'src/management/sso-catalog-entry.ts',
  });
  assert.doesNotMatch(javascript, /sourceMappingURL|process\.env|localStorage|sessionStorage/);
  for (const present of [true, false]) {
    const root = new Element();
    const lifecycle = new EventTarget();
    let requests = 0;
    const context = {
      document: {
        getElementById(id: string) {
          assert.equal(id, 'app');
          return present ? root : null;
        },
      },
      window: lifecycle,
      fetch() {
        requests++;
        throw new Error('Public entry must not acquire authority');
      },
    };
    const keys = Object.keys(context);
    // Use lexical module scope because the builder emits ESM.
    runInNewContext('(() => {' + javascript + '})()', context);
    if (present) assert.match(root.text(), /Sign-in required/);
    lifecycle.dispatchEvent(new Event('pagehide'));
    lifecycle.dispatchEvent(new Event('pageshow'));
    lifecycle.dispatchEvent(new Event('pageshow'));
    assert.equal(requests, 0);
    assert.deepEqual(Object.keys(context), keys, 'no global grant API');
    if (present) assert.match(root.text(), /Sign-in required/);
    else assert.equal(root.text().trim(), '');
  }
});
