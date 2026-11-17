import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createSsoManagementServer } from '../src/gateway/sso-management-http.ts';
import {
  InvalidTokenManagementInput,
  TokenManagementDenied,
} from '../src/gateway/token-management.ts';
import { revokeManagementToken } from '../src/management/token-revoke-client.ts';
import { mountTokenRevocationPanel } from '../src/management/token-revoke-panel.ts';
import { Element, nodes, text } from './account-token-dom-fixture.ts';

function button(root: Element, label: string) {
  const found = nodes(root).find((node) => node.tag === 'button' && node.textContent === label);
  assert.ok(found, label);
  return found;
}
async function waitFor(check: () => boolean) {
  const until = Date.now() + 3000;
  while (!check()) {
    assert.ok(Date.now() < until, 'revocation view did not settle');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('400 revocation is invalid input without reading private diagnostics or retrying', async () => {
  let requests = 0;
  let pulls = 0;
  let cancellations = 0;
  const result = await revokeManagementToken(async () => {
    requests++;
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            pulls++;
            throw new Error('private diagnostic');
          },
          cancel() {
            cancellations++;
          },
        },
        { highWaterMark: 0 },
      ),
      { status: 400 },
    );
  }, 'credential');
  assert.deepEqual(result, { state: 'invalid_input' });
  assert.equal(requests, 1);
  assert.equal(pulls, 0);
  assert.equal(cancellations, 1);
});

test('loopback SSO rejection returns editable form and requires a fresh explicit confirmation', async () => {
  let attempts = 0;
  let requests = 0;
  let mode: 'invalid' | 'ready' | 'deny' | 'unavailable' = 'invalid';
  const server = createSsoManagementServer({
    newRequestId: () => 'revoke-validation',
    authenticate: async (token) => {
      assert.equal(token, 'test-only');
      return 'human';
    },
    issue: async () => {
      throw new Error('unexpected issuance');
    },
    revoke: async ({ credentialId, authenticatedActorId }) => {
      attempts++;
      assert.equal(authenticatedActorId, 'human');
      assert.equal(credentialId, 'credential');
      if (mode === 'invalid') throw new InvalidTokenManagementInput();
      if (mode === 'deny') throw new TokenManagementDenied();
      if (mode === 'unavailable') throw new Error('private-database-diagnostic');
      return true;
    },
    writeAudit: async () => {},
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const root = new Element();
  const panel = mountTokenRevocationPanel(root, async (path, init) => {
    requests++;
    const headers = new Headers(init.headers);
    headers.set('authorization', 'Bearer test-only');
    return fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
  });
  try {
    for (const outcome of ['invalid', 'ready', 'unavailable', 'deny'] as const) {
      mode = outcome;
      assert.ok(panel.review('credential'));
      const confirm = button(root, 'Confirm revocation');
      confirm.listeners.click?.();
      await waitFor(() => !text(root).includes('Revocation in progress.'));
      confirm.listeners.click?.();
      assert.equal(attempts, requests);
      if (outcome === 'invalid') {
        assert.match(
          text(root),
          /Revocation request rejected. Check the credential ID before reviewing again./,
        );
        assert.doesNotMatch(text(root), /outcome is unknown|confirmed|private/);
        assert.equal(nodes(root).find((node) => node.tag === 'input')?.value, '');
        button(root, 'Review revocation');
      } else if (outcome === 'ready') {
        assert.match(text(root), /Token revocation confirmed/);
      } else if (outcome === 'unavailable') {
        assert.match(text(root), /outcome is unknown/);
        assert.doesNotMatch(text(root), /private-database-diagnostic/);
      } else {
        assert.match(text(root), /access denied/);
        assert.equal(panel.review('credential'), false);
        assert.equal(
          nodes(root).some((node) => node.tag === 'input'),
          false,
        );
      }
    }
    assert.equal(requests, 4);
    assert.equal(attempts, 4);
  } finally {
    panel.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
