import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createDirectChatInvoker } from '../src/providers/direct-chat.ts';
import {
  createPostgresDirectProviderRegistrationReader,
  DirectProviderStoreUnavailable,
} from '../src/providers/postgres-direct-providers.ts';

const schema = await readFile(
  new URL('../migrations/007_direct_provider_registrations.sql', import.meta.url),
  'utf8',
);

test('persisted enabled registrations load all three kinds and invoke only registered providers', async () => {
  const db = new PGlite();
  try {
    await db.exec(schema);
    for (const [id, kind, enabled, limit] of [
      ['openai', 'openai', true, null],
      ['anthropic', 'anthropic', true, 256],
      ['google', 'google', true, null],
      ['disabled', 'openai', false, null],
    ]) {
      await db.query('INSERT INTO direct_provider_registrations VALUES ($1, $2, $3, $4, $5)', [
        id,
        kind,
        `secret/${id}`,
        enabled,
        limit,
      ]);
    }
    const load = createPostgresDirectProviderRegistrationReader({
      query: (sql, params) => db.query(sql, [...params]),
    });
    const registrations = await load();
    assert.deepEqual(registrations, [
      {
        providerId: 'anthropic',
        kind: 'anthropic',
        credentialRef: 'secret/anthropic',
        maxOutputTokens: 256,
      },
      { providerId: 'google', kind: 'google', credentialRef: 'secret/google' },
      { providerId: 'openai', kind: 'openai', credentialRef: 'secret/openai' },
    ]);
    const secrets: string[] = [];
    const urls: string[] = [];
    const invoke = createDirectChatInvoker({
      registrations,
      resolveSecret: async (ref) => {
        secrets.push(ref);
        return 'test-key';
      },
      fetcher: async (url) => {
        urls.push(String(url));
        return Response.json({
          id: 'completion',
          choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
        });
      },
    });
    const candidate = {
      id: 'route',
      kind: 'managed' as const,
      providerId: 'openai',
      upstreamModelId: 'gpt-test',
    };
    await invoke(candidate, { model: 'chat', messages: [{ role: 'user', content: 'hello' }] });
    assert.deepEqual(secrets, ['secret/openai']);
    assert.deepEqual(urls, ['https://api.openai.com/v1/chat/completions']);
    await assert.rejects(
      invoke(
        { ...candidate, providerId: 'disabled' },
        { model: 'chat', messages: [{ role: 'user', content: 'hello' }] },
      ),
    );
    assert.equal(secrets.length, 1);
    assert.equal(urls.length, 1);
    await db.query('UPDATE direct_provider_registrations SET enabled = false', []);
    assert.deepEqual(await load(), []);
  } finally {
    await db.close();
  }
});

const row = {
  provider_id: 'openai',
  kind: 'openai',
  credential_ref: 'secret/openai',
  max_output_tokens: null,
  enabled: true,
};

for (const invalid of [
  { ...row, provider_id: '' },
  { ...row, enabled: false },
  { ...row, kind: 'arbitrary' },
  { ...row, credential_ref: 'bad reference' },
  { ...row, kind: 'anthropic' },
  { ...row, max_output_tokens: 0 },
  { ...row, max_output_tokens: '256' },
  { ...row, max_output_tokens: undefined },
  { ...row, max_output_tokens: 1.5 },
  { ...row, max_output_tokens: Number.MAX_SAFE_INTEGER + 1 },
  null,
]) {
  test('invalid persisted registration fails the entire snapshot safely', async () => {
    const load = createPostgresDirectProviderRegistrationReader({
      query: async () => ({ rows: [{ ...row, provider_id: 'other' }, invalid] }),
    });
    await assert.rejects(load(), DirectProviderStoreUnavailable);
  });
}

test('duplicate rows and SQL failures never expose partial data or driver errors', async () => {
  await assert.rejects(
    createPostgresDirectProviderRegistrationReader({ query: async () => ({ rows: [row, row] }) })(),
    DirectProviderStoreUnavailable,
  );
  await assert.rejects(
    createPostgresDirectProviderRegistrationReader({
      query: async () => {
        throw new Error('secret driver data');
      },
    })(),
    (error) => error instanceof DirectProviderStoreUnavailable && !String(error).includes('secret'),
  );
});

test('reader copies allowlisted fields and snapshots independently', async () => {
  const source = {
    ...row,
    provider_key: 'excluded',
    arbitrary_url: 'https://unregistered.invalid',
  };
  const load = createPostgresDirectProviderRegistrationReader({
    query: async () => ({ rows: [source] }),
  });
  const result = await load();
  source.credential_ref = 'secret/changed';
  assert.deepEqual(result, [
    { providerId: 'openai', kind: 'openai', credentialRef: 'secret/openai' },
  ]);
});
