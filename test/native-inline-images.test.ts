import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { prepareAnthropicMessages } from '../src/providers/anthropic-client-functions.ts';
import { prepareGoogleMessages } from '../src/providers/google-client-functions.ts';
import { imageFixture, imagePrivacy, inlineUrl } from './inline-image-inputs-fixture.ts';
import {
  nativeBase64,
  nativeExpected,
  nativeImageFixture,
  nativeImageHistory,
} from './native-inline-images-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const nativeMessage = nativeImageHistory[0];
assert.ok(nativeMessage);

const nativeHistory = [
  {
    role: 'user' as const,
    content: [
      { type: 'text' as const, text: 'private image question Ω' },
      { type: 'image_url' as const, image_url: { url: inlineUrl } },
      { type: 'text' as const, text: '' },
    ],
  },
];
test('Anthropic omitted-detail images cross the authorized public boundary in native order', async () => {
  const f = imageFixture('anthropic');
  const response = await f.handler(f.request('/api/v1', { messages: nativeHistory }));
  assert.equal(response.status, 200);
  await response.text();
  assert.deepEqual(f.sent[0]?.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'private image question Ω' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: inlineUrl.slice(22) },
        },
        { type: 'text', text: '' },
      ],
    },
  ]);
  imagePrivacy(f);
});

for (const kind of ['anthropic', 'google'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'function'] as const) {
      const fields = {
        messages: nativeImageHistory,
        stream,
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      };
      test(`${kind} ${mode} stream=${stream}: ordered native inline images survive both bases`, async () => {
        for (const base of ['/v1', '/api/v1']) {
          const f = nativeImageFixture(kind, { stream, mode });
          const response = await f.handler(f.request(base, fields));
          assert.equal(response.status, 200);
          const output = await response.text();
          if (stream) assert.ok(output.endsWith('data: [DONE]\n\n'));
          assert.doesNotMatch(output, /base64|iVBOR|private image/u);
          assert.deepEqual(
            f.sent[0]?.[kind === 'anthropic' ? 'messages' : 'contents'],
            nativeExpected(kind),
          );
          assert.equal(f.records[0]?.usage.totalTokens, 3);
          assert.equal(f.counts().secrets, 1);
          imagePrivacy(f);
        }
      });
      test(`${kind} ${mode} stream=${stream}: image auth, model/provider Deny, limits and persistence stay enforced`, async () => {
        for (const [gate, status] of [
          ['auth', 401],
          ['implicit', 403],
          ['model', 403],
          ['provider', 403],
          ['limit', 429],
          ['selection', 503],
          ['audit', 503],
          ['usage', 503],
        ] as const)
          for (const base of ['/v1', '/api/v1']) {
            const f = nativeImageFixture(kind, { stream, mode, gate });
            const response = await f.handler(f.request(base, fields));
            const persisted = gate === 'audit' || gate === 'usage';
            assert.equal(response.status, stream && persisted ? 200 : status);
            assert.doesNotMatch(await response.text(), /iVBOR|base64|private image|\[DONE\]/u);
            assert.equal(f.counts().secrets, persisted ? 1 : 0);
            assert.equal(f.sent.length, persisted ? 1 : 0);
            imagePrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: missing usage and failed attempts never infer image cost`, async () => {
        const missing = nativeImageFixture(kind, { stream, mode, missingUsage: true });
        const response = await missing.handler(missing.request('/api/v1', fields));
        assert.equal(response.status, 200);
        await response.text();
        assert.equal(missing.records[0]?.usage.status, 'missing');
        assert.equal(missing.records[0]?.usage.totalTokens, null);
        imagePrivacy(missing);
        const failed = nativeImageFixture(kind, { stream, mode, transportFails: true });
        const error = await failed.handler(failed.request('/api/v1', fields));
        assert.equal(error.status, 502);
        assert.doesNotMatch(await error.text(), /base64|iVBOR|private|\[DONE\]/u);
        assert.equal(failed.records.length, 1);
        assert.equal(failed.records[0]?.possiblyBilled, true);
        assert.equal(failed.sent.length, 1);
        imagePrivacy(failed);
      });
      test(`${kind} ${mode} stream=${stream}: supplied detail and unselected native MIME reject before credentials`, async () => {
        for (const image_url of [
          ...['auto', 'low', 'high'].map((detail) => ({ url: inlineUrl, detail })),
          ...(kind === 'google' ? [{ url: inlineUrl.replace('/png', '/gif') }] : []),
        ]) {
          const f = nativeImageFixture(kind, { stream, mode });
          const response = await f.handler(
            f.request('/api/v1', {
              ...fields,
              messages: [{ role: 'user', content: [{ type: 'image_url', image_url }] }],
            }),
          );
          assert.equal(response.status, 502);
          assert.doesNotMatch(await response.text(), /base64|iVBOR|private|\[DONE\]/u);
          assert.equal(f.counts().secrets, 0);
          assert.equal(f.sent.length, 0);
          imagePrivacy(f);
        }
      });
    }

for (const kind of ['anthropic', 'google'] as const) {
  test(`${kind}: secret failure and an invalid first image getter remain private without upstream contact`, async () => {
    for (const stream of [false, true])
      for (const mode of ['text', 'function'] as const) {
        const f = nativeImageFixture(kind, {
          stream,
          mode,
          mutate: () => {
            throw new Error(`private image ${inlineUrl} fixture-provider-key`);
          },
        });
        const response = await f.handler(
          f.request('/api/v1', {
            messages: nativeImageHistory,
            stream,
            ...(mode === 'function' ? { tools: probabilityTools } : {}),
          }),
        );
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /base64|iVBOR|private|fixture-provider-key/u);
        assert.equal(f.counts().secrets, 1);
        assert.equal(f.sent.length, 0);
        assert.equal(f.records.length, 0);
        imagePrivacy(f);
      }
    let reads = 0;
    const image_url = Object.defineProperty({}, 'url', {
      enumerable: true,
      get: () => (++reads === 1 ? 'https://private.invalid/image' : inlineUrl),
    });
    const invalid = nativeImageFixture(kind);
    await assert.rejects(() =>
      invalid.call({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url }] }] }),
    );
    assert.equal(reads, 1);
    assert.equal(invalid.counts().secrets, 0);
    assert.equal(invalid.sent.length, 0);
  });
  test(`${kind}: selected MIME types, multiple and image-only arrays preserve exact payloads`, async () => {
    for (const mime of kind === 'anthropic'
      ? ['png', 'jpeg', 'webp', 'gif']
      : ['png', 'jpeg', 'webp']) {
      const url = inlineUrl.replace('/png', `/${mime}`);
      const messages = [
        {
          role: 'user',
          content: Array.from({ length: 2 }, () => ({ type: 'image_url', image_url: { url } })),
        },
      ];
      const f = nativeImageFixture(kind);
      const response = await f.handler(f.request('/api/v1', { messages }));
      assert.equal(response.status, 200);
      await response.text();
      const image =
        kind === 'anthropic'
          ? {
              type: 'image',
              source: { type: 'base64', media_type: `image/${mime}`, data: nativeBase64 },
            }
          : { inlineData: { mimeType: `image/${mime}`, data: nativeBase64 } };
      assert.deepEqual(f.sent[0]?.[kind === 'anthropic' ? 'messages' : 'contents'], [
        { role: 'user', [kind === 'anthropic' ? 'content' : 'parts']: [image, image] },
      ]);
      imagePrivacy(f);
    }
  });
  test(`${kind}: twenty native images pass and twenty-one across history fail before credentials`, async () => {
    for (const count of [20, 21]) {
      const messages = Array.from({ length: count }, () => ({
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: inlineUrl } }],
      }));
      const f = nativeImageFixture(kind);
      const response = await f.handler(f.request('/api/v1', { messages }));
      assert.equal(response.status, count === 20 ? 200 : 502);
      await response.text();
      assert.equal(f.counts().secrets, count === 20 ? 1 : 0);
      assert.equal(f.sent.length, count === 20 ? 1 : 0);
      imagePrivacy(f);
    }
    const converter = kind === 'anthropic' ? prepareAnthropicMessages : prepareGoogleMessages;
    const repeated = { type: 'image_url' as const, image_url: { url: inlineUrl } };
    assert.throws(() => converter([{ role: 'user', content: Array(21).fill(repeated) }]));
  });
  test(`${kind}: invalid images, non-user roles and cache mixtures still reject before routing`, async () => {
    for (const fields of [
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } },
            ],
          },
        ],
      },
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YR==' } }],
          },
        ],
      },
      { messages: [{ role: 'assistant', content: nativeMessage.content }] },
      { cache_control: { type: 'ephemeral' } },
      { prompt_cache_options: { mode: 'explicit' } },
      { tools: [{ ...probabilityTools[0], cache_control: { type: 'ephemeral' } }] },
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'private', cache_control: { type: 'ephemeral' } },
              ...nativeMessage.content,
            ],
          },
        ],
      },
    ]) {
      const f = nativeImageFixture(kind);
      const response = await f.handler(
        f.request('/api/v1', { messages: nativeImageHistory, ...fields }),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
      assert.doesNotMatch(await response.text(), /base64|iVBOR|private/u);
    }
  });
  test(`${kind}: captured image/text cannot change at secret resolution`, async () => {
    const messages = structuredClone(nativeImageHistory);
    const first = messages[0];
    assert.ok(first);
    const f = nativeImageFixture(kind, {
      mutate: () => {
        first.content.splice(0, first.content.length);
      },
    });
    await f.call({ messages });
    assert.deepEqual(
      f.sent[0]?.[kind === 'anthropic' ? 'messages' : 'contents'],
      nativeExpected(kind),
    );
    let reads = 0;
    const image_url = Object.defineProperty({}, 'url', {
      enumerable: true,
      get: () => (++reads === 1 ? inlineUrl : 'private invalid second value'),
    });
    const one = nativeImageFixture(kind);
    await one.call({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url }] }] });
    assert.equal(reads, 1);
    assert.equal(one.sent.length, 1);
  });
  test(`${kind}: exported converters reject non-user images, malformed payloads, cache mixtures and unsupported Google plain arrays`, () => {
    const converter = kind === 'anthropic' ? prepareAnthropicMessages : prepareGoogleMessages;
    assert.deepEqual(converter(snapshotChatMessages(nativeImageHistory)), nativeExpected(kind));
    assert.throws(() => converter([{ role: 'assistant', content: nativeMessage.content }]));
    assert.throws(() =>
      converter([
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://private.invalid/image' } }],
        },
      ]),
    );
    assert.throws(() =>
      converter([
        ...nativeImageHistory,
        {
          role: 'user',
          content: [{ type: 'text', text: 'private', cache_control: { type: 'ephemeral' } }],
        },
      ]),
    );
    if (kind === 'google')
      assert.throws(() =>
        converter([{ role: 'user', content: [{ type: 'text', text: 'plain' }] }]),
      );
  });
}
