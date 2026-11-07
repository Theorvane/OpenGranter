import assert from 'node:assert/strict';
import test from 'node:test';
import { mountSsoUsageWorkspace } from '../src/management/sso-usage-workspace.ts';
import { TokenElement } from './token-management-dom-fixture.ts';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
test('Account reads approved current principal and clears it on navigation/logout', async () => {
  const root = new TokenElement();
  const paths: string[] = [];
  const app = mountSsoUsageWorkspace(root, new EventTarget(), { now: () => 100 });
  await app.authorize({ expiresAt: 200, request: async (path) => {
    paths.push(path);
    return path.endsWith('/me') ? Response.json({principalId: 'human-admin'}) : Response.json({object:'list',data:[]});
  }});
  root.button('Account').click();
  await settle();
  assert.match(root.text(), /Current principal: human-admin/);
  assert.deepEqual(paths, ['/management/v1/models', '/management/v1/me']);
  root.button('Models').click();
  await settle();
  assert.doesNotMatch(root.text(), /human-admin/);
  app.clear();
  app.dispose();
});
