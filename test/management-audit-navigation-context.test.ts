import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

test('Audit retains its own heading before authentication and through identity states', async (t) => {
  const root = new TokenElement();
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  t.after(() => app.dispose());
  const assertAudit = () => {
    assert.deepEqual(
      root
        .all()
        .filter((node) => node.tag === 'h1')
        .map((node) => node.textContent),
      ['Audit'],
    );
    assert.doesNotMatch(root.text(), /Identity is not permission to administer resources/);
    assert.equal(root.button('Audit').attrs['aria-current'], 'page');
  };
  root.button('Audit').click();
  assertAudit();
  assert.match(root.text(), /Sign-in required/);
  for (const status of [401, 403, 503]) {
    let complete!: (response: Response) => void;
    const paths: string[] = [];
    await app.authorize({
      expiresAt: 200,
      request: async (path) => {
        paths.push(path);
        return path.endsWith('/me')
          ? new Promise<Response>((done) => {
              complete = done;
            })
          : Response.json({ object: 'list', data: [] });
      },
    });
    root.button('Audit').click();
    assertAudit();
    assert.match(root.text(), /Loading current principal/);
    complete(new Response('private-error', { status }));
    await settle();
    assertAudit();
    assert.match(
      root.text(),
      status === 401
        ? /Sign-in required/
        : status === 403
          ? /Access denied/
          : /Current principal unavailable/,
    );
    assert.doesNotMatch(root.text(), /private-error/);
    assert.deepEqual(paths, ['/management/v1/models', '/management/v1/me']);
  }
  app.clear('expired');
  assertAudit();
  assert.match(root.text(), /Session expired/);
  root.button('Account').click();
  assert.deepEqual(
    root
      .all()
      .filter((node) => node.tag === 'h1')
      .map((node) => node.textContent),
    ['Account'],
  );
  assert.match(root.text(), /Identity is not permission to administer resources/);
});
