import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { normalizeClientTextMessages } from '../src/gateway/client-text-messages.ts';
import {
  MAX_INLINE_IMAGE_HISTORY_UNITS,
  MAX_INLINE_IMAGE_URL_UNITS,
} from '../src/gateway/inline-image-parts.ts';
import { chatContentText } from '../src/gateway/prompt-cache-parts.ts';
import { prepareAnthropicMessages } from '../src/providers/anthropic-client-functions.ts';
import { prepareGoogleMessages } from '../src/providers/google-client-functions.ts';
import {
  imageFixture,
  imageHistory,
  imagePart,
  imagePrivacy,
  inlineUrl,
} from './inline-image-inputs-fixture.ts';
import { probabilityTools } from './nonstream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
const history = (content: unknown, role = 'user') => [{ role, content }];
for (const kind of ['openai', 'openrouter'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'refusal', 'function'] as const) {
      const fields = {
        messages: imageHistory,
        stream,
        ...(mode === 'function' ? { tools: probabilityTools } : {}),
      };
      test(`${kind} ${mode} stream=${stream}: authorized inline image order survives both bases`, async () => {
        for (const base of bases) {
          const f = imageFixture(kind, { stream, mode });
          const r = await f.handler(f.request(base, fields));
          assert.equal(r.status, 200);
          const text = await r.text();
          assert.doesNotMatch(text, /base64|data:image|private image|iVBOR/u);
          if (stream) assert.ok(text.endsWith('data: [DONE]\n\n'));
          assert.deepEqual(f.sent[0]?.messages, imageHistory);
          assert.equal(f.records[0]?.usage.totalTokens, 3);
          if (kind === 'openrouter')
            assert.deepEqual(f.sent[0]?.provider, {
              only: ['provider'],
            });
          imagePrivacy(f);
        }
      });
      test(`${kind} ${mode} stream=${stream}: images retain auth, IAM, limits and persistence gates`, async () => {
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
          for (const base of bases) {
            const f = imageFixture(kind, { stream, mode, gate });
            const r = await f.handler(f.request(base, fields));
            assert.equal(r.status, stream && (gate === 'audit' || gate === 'usage') ? 200 : status);
            assert.doesNotMatch(await r.text(), /base64|private image|iVBOR|\[DONE\]/u);
            assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
            imagePrivacy(f);
          }
      });
      test(`${kind} ${mode} stream=${stream}: missing usage and upstream failure stay safe`, async () => {
        const missing = imageFixture(kind, { stream, mode, missingUsage: true });
        const r = await missing.handler(missing.request('/api/v1', fields));
        assert.equal(r.status, 200);
        await r.text();
        assert.equal(missing.records[0]?.usage.status, 'missing');
        assert.equal(missing.records[0]?.usage.totalTokens, null);
        imagePrivacy(missing);
        const failed = imageFixture(kind, { stream, mode, transportFails: true });
        const error = await failed.handler(failed.request('/api/v1', fields));
        await error.text();
        assert.ok(error.status === 502 || error.status === 200);
        assert.equal(failed.records.length, 1);
        imagePrivacy(failed);
      });
    }
for (const kind of ['anthropic', 'google'] as const)
  for (const stream of [false, true])
    for (const mode of ['text', 'function'] as const)
      test(`${kind} ${mode} stream=${stream}: unsupported images fail before credentials`, async () => {
        for (const base of bases) {
          const f = imageFixture(kind, { stream, mode });
          const r = await f.handler(
            f.request(base, {
              messages: imageHistory,
              stream,
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            }),
          );
          assert.equal(r.status, 502);
          assert.doesNotMatch(await r.text(), /base64|private|iVBOR/u);
          assert.equal(f.counts().secrets, 0);
          assert.equal(f.sent.length, 0);
          imagePrivacy(f);
        }
      });
for (const kind of ['openai', 'openrouter'] as const) {
  test(`${kind}: all portable MIME/detail literals and image-only arrays preserve omission`, async () => {
    for (const mime of ['png', 'jpeg', 'webp', 'gif'])
      for (const detail of [undefined, 'auto', 'low', 'high']) {
        const content = [
          {
            type: 'image_url',
            image_url: {
              url: inlineUrl.replace('/png', `/${mime}`),
              ...(detail === undefined ? {} : { detail }),
            },
          },
        ];
        const f = imageFixture(kind);
        const r = await f.handler(f.request('/api/v1', { messages: history(content) }));
        assert.equal(r.status, 200);
        await r.text();
        assert.deepEqual(f.sent[0]?.messages, history(content));
        imagePrivacy(f);
      }
  });
  test(`${kind}: malformed images reject before route resolution on both bases`, async () => {
    for (const content of [
      [{ type: 'image_url' }],
      [{ type: 'image_url', image_url: null }],
      [{ ...imagePart, unknown: true }],
      ...[
        null,
        12,
        '',
        'https://example.invalid/image.png',
        'file:///private/image',
        'data:image/svg+xml;base64,YQ==',
        'data:image/png;base64,',
        'data:image/png;base64,YQ',
        'data:image/png;base64,YQ===',
        'data:image/png;base64,YR==',
        'data:image/png;base64,Y Q==',
        'data:image/png;base64,YQ==\n',
      ].map((url) => [{ type: 'image_url', image_url: { url } }]),
      ...[null, 12, 'original', 'future'].map((detail) => [
        { type: 'image_url', image_url: { url: inlineUrl, detail } },
      ]),
      [{ type: 'image_url', image_url: { url: inlineUrl, token: 'private' } }],
      [{ ...imagePart, cache_control: { type: 'ephemeral' } }],
      [{ type: 'text', text: 'private', cache_control: { type: 'ephemeral' } }, imagePart],
      [{ type: 'text', text: 'private', prompt_cache_breakpoint: { mode: 'explicit' } }, imagePart],
      Array.from({ length: 129 }, () => imagePart),
    ])
      for (const base of bases) {
        const f = imageFixture(kind);
        const r = await f.handler(f.request(base, { messages: history(content) }));
        assert.equal(r.status, 400);
        assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
        assert.doesNotMatch(await r.text(), /base64|private|iVBOR/u);
      }
  });
  test(`${kind}: other roles and cross-history cache combinations reject before routes`, async () => {
    for (const role of ['system', 'developer', 'assistant', 'tool']) {
      const f = imageFixture(kind);
      const r = await f.handler(f.request('/api/v1', { messages: history([imagePart], role) }));
      assert.equal(r.status, 400);
      assert.equal(f.counts().routes, 0);
    }
    for (const fields of [
      { cache_control: { type: 'ephemeral' } },
      { prompt_cache_options: { mode: 'explicit' } },
      { tools: [{ ...probabilityTools[0], cache_control: { type: 'ephemeral' } }] },
      {
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: 'private', cache_control: { type: 'ephemeral' } }],
          },
          ...imageHistory,
        ],
      },
    ]) {
      const f = imageFixture(kind);
      const r = await f.handler(f.request('/api/v1', { messages: imageHistory, ...fields }));
      assert.equal(r.status, 400);
      assert.deepEqual(f.counts(), { routes: 0, secrets: 0 });
    }
  });
}
function sizedUrl(payloadUnits: number) {
  return `data:image/png;base64,${'A'.repeat(payloadUnits)}`;
}
test('per-image and aggregate history budgets admit the boundary and reject overflow before routes', async () => {
  const payload = Math.floor((MAX_INLINE_IMAGE_URL_UNITS - 21) / 4) * 4;
  for (const [urls, allowed] of [
    [[sizedUrl(payload)], true],
    [[sizedUrl(payload + 4)], false],
    [[sizedUrl(payload), sizedUrl(4)], true],
    [[sizedUrl(payload), sizedUrl(300000)], false],
  ] as const) {
    const messages = urls.map((url) => ({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url } }],
    }));
    const f = imageFixture('openrouter');
    const r = await f.handler(f.request('/api/v1', { messages }));
    assert.equal(r.status, allowed ? 200 : 400);
    await r.text();
    if (!allowed) assert.equal(f.counts().routes, 0);
  }
  const first = sizedUrl(payload);
  const tail = sizedUrl(Math.floor((MAX_INLINE_IMAGE_HISTORY_UNITS - first.length - 21) / 4) * 4);
  assert.doesNotThrow(() =>
    snapshotChatMessages(
      history([
        { type: 'image_url', image_url: { url: first } },
        { type: 'image_url', image_url: { url: tail } },
      ]),
    ),
  );
  assert.throws(
    () =>
      snapshotChatMessages(
        history([
          { type: 'image_url', image_url: { url: first } },
          { type: 'image_url', image_url: { url: `${tail}AAAA` } },
        ]),
      ),
    TypeError,
  );
});
test('image primitive captures are single reads and deeply frozen through async secret mutation', async () => {
  let types = 0,
    images = 0,
    urls = 0,
    details = 0;
  const part = Object.defineProperties(
    {},
    {
      type: {
        enumerable: true,
        get: () => {
          types++;
          return types === 1 ? 'image_url' : 'text';
        },
      },
      image_url: {
        enumerable: true,
        get: () => {
          images++;
          return Object.defineProperties(
            {},
            {
              url: {
                enumerable: true,
                get: () => {
                  urls++;
                  return urls === 1 ? inlineUrl : 'https://private.invalid';
                },
              },
              detail: {
                enumerable: true,
                get: () => {
                  details++;
                  return details === 1 ? 'high' : null;
                },
              },
            },
          );
        },
      },
    },
  );
  const captured = snapshotChatMessages(normalizeClientTextMessages(history([part])));
  assert.deepEqual([types, images, urls, details], [1, 1, 1, 1]);
  assert.deepEqual(
    captured,
    history([{ type: 'image_url', image_url: { url: inlineUrl, detail: 'high' } }]),
  );
  assert.ok(Object.isFrozen(captured));
  const content = captured[0]?.content;
  assert.ok(Array.isArray(content));
  assert.ok(Object.isFrozen(content));
  assert.ok(Object.isFrozen(content[0]));
  assert.ok(Object.isFrozen(content[0].image_url));
  const mutable = structuredClone(imageHistory);
  const f = imageFixture('openai', {
    mutate: () => {
      const first = mutable[0];
      assert.ok(first);
      first.content[1] = { type: 'text', text: 'private late' };
    },
  });
  await f.call({ messages: snapshotChatMessages(normalizeClientTextMessages(mutable)) });
  assert.deepEqual(f.sent[0]?.messages, imageHistory);
  imagePrivacy(f);
});
test('exported native converters and selector text view reject images instead of dropping them', () => {
  const captured = snapshotChatMessages(imageHistory);
  assert.throws(() => prepareAnthropicMessages(captured));
  assert.throws(() => prepareGoogleMessages(captured));
  const first = captured[0];
  assert.ok(first);
  assert.throws(() => chatContentText(first.content));
});
test('text-prompt Jev route blocks images before selector secrets; metadata-only choice stays available', async () => {
  for (const sendPrompt of [true, false]) {
    const f = imageFixture('openai');
    let selectors = 0,
      secrets = 0;
    const handler = createChatHandler({
      ...f.ports,
      resolveRoute: async () => ({
        kind: 'managed',
        version: 'v1',
        candidates: [
          { id: 'c', kind: 'managed', providerId: 'provider', upstreamModelId: 'upstream-model' },
        ],
        jev: { credentialRef: 'secret/jev', minimumConfidence: 0.5, sendPrompt },
      }),
      resolveSecret: async () => {
        secrets++;
        return 'fixture-selector';
      },
      fetchJev: async (_url, request) => {
        selectors++;
        assert.doesNotMatch(request.body, /image|base64|iVBOR/u);
        return {
          ok: true,
          json: async () => ({
            model: 'jev',
            answers: { route: { type: 'choice', choice: 'c', confidence: 1 } },
          }),
        };
      },
    });
    const r = await handler(f.request('/api/v1', { messages: imageHistory }));
    assert.equal(r.status, sendPrompt ? 503 : 200);
    await r.text();
    assert.equal(selectors, sendPrompt ? 0 : 1);
    assert.equal(secrets, sendPrompt ? 0 : 1);
    imagePrivacy(f);
  }
});

test('over-budget image prefix rejects before reading later payload getters', () => {
  const oversized = [
    { type: 'image_url', image_url: { url: sizedUrl(524260) } },
    { type: 'image_url', image_url: { url: sizedUrl(300000) } },
  ];
  let reads = 0;
  const later = {
    type: 'image_url',
    image_url: Object.defineProperty({}, 'url', {
      enumerable: true,
      get: () => {
        reads++;
        return inlineUrl;
      },
    }),
  };
  for (const capture of [
    snapshotChatMessages,
    (value: unknown) => snapshotChatMessages(normalizeClientTextMessages(value)),
  ]) {
    assert.throws(() => capture(history([...oversized, later])), TypeError);
    assert.equal(reads, 0);
  }
});

test('invalid first image primitive rejects without retries, coercion or inherited fields', () => {
  for (const field of ['url', 'detail']) {
    let reads = 0,
      coercions = 0;
    const image = Object.defineProperty(field === 'detail' ? { url: inlineUrl } : {}, field, {
      enumerable: true,
      get: () => {
        reads++;
        return reads === 1
          ? {
              toString: () => {
                coercions++;
                return inlineUrl;
              },
            }
          : field === 'detail'
            ? 'low'
            : inlineUrl;
      },
    });
    assert.throws(() =>
      normalizeClientTextMessages(history([{ type: 'image_url', image_url: image }])),
    );
    assert.equal(reads, 1);
    assert.equal(coercions, 0);
  }
  for (const content of [
    [Object.create({ type: 'image_url', image_url: { url: inlineUrl } })],
    [{ type: 'image_url', image_url: Object.create({ url: inlineUrl }) }],
    new Array(1),
  ])
    assert.throws(() => snapshotChatMessages(history(content)));
});
test('image normalization captures fixed part positions before mutation and ignores later source changes', () => {
  const parts: unknown[] = [];
  const first = Object.defineProperty({ image_url: { url: inlineUrl } }, 'type', {
    enumerable: true,
    get: () => {
      parts[1] = { type: 'image_url', image_url: { url: 'https://private.invalid' } };
      parts.push(imagePart);
      return 'image_url';
    },
  });
  parts.push(first, { type: 'text', text: 'private image original' });
  const captured = snapshotChatMessages(normalizeClientTextMessages(history(parts)));
  assert.deepEqual(
    captured,
    history([
      { type: 'image_url', image_url: { url: inlineUrl } },
      { type: 'text', text: 'private image original' },
    ]),
  );
});
