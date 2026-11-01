import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountManagementBoundaryView } from '../src/management/boundary-view.ts';

class ElementFixture {
  textContent: string | null = null;
  attributes: Record<string, string> = {};
  children: ElementFixture[] = [];
  replacements = 0;
  ownerDocument = { createElement: (tag: string) => new ElementFixture(tag) };
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  append(...nodes: ElementFixture[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: ElementFixture[]): void {
    this.replacements++;
    this.textContent = null;
    this.children = nodes;
  }
}

const cases = [
  ['loading', 'Checking your session', 'status'],
  ['unauthenticated', 'Sign-in required', 'status'],
  ['expired', 'Session expired', 'alert'],
  ['denied', 'Access denied', 'alert'],
  ['unavailable', 'Management unavailable', 'alert'],
] as const;

for (const [state, heading, role] of cases) {
  test(`mount ${state} replaces stale protected subtree`, () => {
    const root = new ElementFixture('div');
    const stale = new ElementFixture('nav');
    stale.textContent = 'private principal and token controls';
    root.children = [stale];
    root.textContent = 'private';
    mountManagementBoundaryView(root, state);
    assert.equal(root.replacements, 1);
    assert.equal(root.textContent, null);
    assert.equal(root.children.length, 1);
    const main = root.children[0];
    assert.ok(main);
    assert.equal(main.tag, 'main');
    assert.deepEqual(
      main.children.map((node) => node.tag),
      ['h1', 'p'],
    );
    assert.equal(main.children[0]?.textContent, heading);
    assert.equal(main.children[1]?.attributes.role, role);
    assert.equal(
      main.children[1]?.attributes['aria-live'],
      state === 'loading' ? 'polite' : undefined,
    );
    assert.ok(!JSON.stringify(root).includes('private'));
  });
}

test('transitions retain only the latest boundary nodes', () => {
  const root = new ElementFixture('div');
  for (const [state, heading] of cases) {
    mountManagementBoundaryView(root, state);
    assert.equal(root.children.length, 1);
    assert.equal(root.children[0]?.children[0]?.textContent, heading);
  }
  assert.equal(root.replacements, cases.length);
});

test('unknown inputs never invoke coercion and fail closed', () => {
  const hostile = {
    toString() {
      throw new Error('must not coerce');
    },
  };
  for (const state of [
    hostile,
    null,
    undefined,
    ['loading'],
    '<script>private</script>',
    'ready',
  ]) {
    const root = new ElementFixture('div');
    mountManagementBoundaryView(root, state);
    assert.equal(root.children[0]?.children[0]?.textContent, 'Management unavailable');
    assert.ok(!JSON.stringify(root).includes('private'));
  }
});
