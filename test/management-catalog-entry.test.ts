import assert from 'node:assert/strict';
import { test } from 'node:test';
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
}
function text(root: Element): string {
  return [root.textContent ?? '', ...root.children.map(text)].join(' ');
}

test('actual bundled entry mounts signed-out without network and disposes on pagehide', async () => {
  const javascript = await buildManagementBrowser({
    root: process.cwd(),
    entry: 'src/management/catalog-entry.ts',
  });
  const root = new Element();
  let dispose: (() => void) | undefined;
  const context = {
    document: {
      getElementById(id: string) {
        assert.equal(id, 'app');
        return root;
      },
    },
    window: {
      addEventListener(type: string, listener: () => void, options: unknown) {
        assert.equal(type, 'pagehide');
        assert.deepEqual(JSON.parse(JSON.stringify(options)), { once: true });
        dispose = listener;
      },
    },
    fetch() {
      assert.fail('public entry must not fetch');
    },
  };
  runInNewContext(javascript, context);
  assert.match(text(root), /Sign-in required/);
  assert.ok(dispose);
  dispose();
  assert.equal(root.children.length, 0);
  assert.deepEqual(Object.keys(context.window), ['addEventListener']);
  runInNewContext(javascript, {
    document: {
      getElementById() {
        return null;
      },
    },
    window: {
      addEventListener() {
        assert.fail('missing root must not register lifecycle');
      },
    },
  });
});
