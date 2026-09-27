import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDirectChatInvoker,
  type DirectProviderRegistration,
} from '../src/providers/direct-chat.ts';

const registration: DirectProviderRegistration = {
  providerId: 'openai',
  kind: 'openai',
  credentialRef: 'secret/openai',
};

test('duplicate provider registrations fail before any external contact', () => {
  let calls = 0;
  assert.throws(
    () =>
      createDirectChatInvoker({
        registrations: [
          registration,
          { ...registration, credentialRef: 'private other reference' },
        ],
        resolveSecret: async () => {
          calls++;
          return 'private secret';
        },
        fetcher: async () => {
          calls++;
          return new Response();
        },
      }),
    {
      name: 'InvalidDirectProviderConfiguration',
      message: 'Invalid direct provider configuration',
    },
  );
  assert.equal(calls, 0);
});

test('malformed registrations produce only fixed safe errors', () => {
  const malformed: unknown[] = [
    null,
    { ...registration, providerId: '' },
    { ...registration, providerId: 'bad id' },
    { ...registration, kind: 'invented' },
    { ...registration, credentialRef: '' },
    { ...registration, credentialRef: 'private\nreference' },
    { ...registration, kind: 'anthropic' },
    { ...registration, kind: 'anthropic', maxOutputTokens: 0 },
    { ...registration, kind: 'anthropic', maxOutputTokens: 1.5 },
  ];
  for (const input of malformed) {
    let calls = 0;
    assert.throws(
      () =>
        createDirectChatInvoker({
          registrations: [input as DirectProviderRegistration],
          resolveSecret: async () => {
            calls++;
            return 'private secret';
          },
        }),
      {
        name: 'InvalidDirectProviderConfiguration',
        message: 'Invalid direct provider configuration',
      },
    );
    assert.equal(calls, 0);
  }
});

test('caller mutation cannot change a validated invoker registration', async () => {
  const mutable = {
    providerId: 'openai',
    kind: 'openai' as 'openai' | 'google',
    credentialRef: 'secret/openai',
  };
  const registrations = [mutable];
  const contacts: string[] = [];
  const invoke = createDirectChatInvoker({
    registrations,
    resolveSecret: async (reference) => {
      contacts.push(reference);
      return 'private key';
    },
    fetcher: async (url) => {
      contacts.push(String(url));
      return Response.json({
        id: 'completion',
        choices: [{ message: { role: 'assistant', content: 'hello' } }],
      });
    },
  });
  mutable.kind = 'google';
  mutable.credentialRef = 'secret/replacement';
  registrations.splice(0, 1);
  const result = await invoke(
    { id: 'one', kind: 'managed', providerId: 'openai', upstreamModelId: 'gpt' },
    {
      model: 'chat',
      messages: [{ role: 'user', content: 'hello' }],
    },
  );
  assert.deepEqual(contacts, ['secret/openai', 'https://api.openai.com/v1/chat/completions']);
  assert.equal(result.choices[0].message.content, 'hello');
});
