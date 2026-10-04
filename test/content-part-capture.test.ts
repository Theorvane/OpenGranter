import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { normalizeClientTextMessages } from '../src/gateway/client-text-messages.ts';

function normalize(content: unknown, role = 'assistant') {
  return normalizeClientTextMessages([{ role, content }]);
}
test('text payload is validated and normalized from one capture without second-value coercion', () => {
  for (const role of ['system', 'developer', 'user', 'assistant', 'tool']) {
    let reads = 0;
    let coercions = 0;
    const part = Object.defineProperty({ type: 'text' }, 'text', {
      enumerable: true,
      get: () => {
        reads++;
        return reads === 1
          ? 'private validated Ω'
          : {
              toString: () => {
                coercions++;
                return 'unvalidated replacement';
              },
            };
      },
    });
    assert.deepEqual(normalize([part], role), [{ role, content: 'private validated Ω' }]);
    assert.equal(reads, 1);
    assert.equal(coercions, 0);
  }
});
test('sole assistant index and discriminator use one capture for either text or refusal', () => {
  for (const type of ['text', 'refusal']) {
    let indexes = 0;
    let types = 0;
    const part = Object.defineProperty(
      type === 'text' ? { text: 'private text' } : { refusal: 'private refusal' },
      'type',
      {
        enumerable: true,
        get: () => {
          types++;
          return types === 1 ? type : 'image_url';
        },
      },
    );
    const content = new Array(1);
    Object.defineProperty(content, '0', {
      enumerable: true,
      get: () => {
        indexes++;
        return indexes === 1 ? part : { type: 'text', text: 'private replacement' };
      },
    });
    assert.deepEqual(
      normalize(content),
      type === 'text'
        ? [{ role: 'assistant', content: 'private text' }]
        : [{ role: 'assistant', content: null, refusal: 'private refusal' }],
    );
    assert.equal(indexes, 1);
    assert.equal(types, 1);
  }
});
test('fixed part sequence survives array replacement and append during discriminator validation', () => {
  const content: unknown[] = [];
  const first = Object.defineProperty({ text: 'first ' }, 'type', {
    enumerable: true,
    get: () => {
      content[1] = { type: 'image_url', image_url: 'private replacement' };
      content.push({ type: 'text', text: 'private appended' });
      return 'text';
    },
  });
  content.push(first, { type: 'text', text: 'Ω tail' });
  assert.deepEqual(normalize(content), [{ role: 'assistant', content: 'first Ω tail' }]);
});
test('invalid first field captures reject without retries or payload coercion', () => {
  let types = 0;
  const type = Object.defineProperty({ text: 'private' }, 'type', {
    enumerable: true,
    get: () => {
      types++;
      return types === 1 ? 'image_url' : 'text';
    },
  });
  assert.throws(() => normalize([type]), TypeError);
  assert.equal(types, 1);
  for (const kind of ['text', 'refusal']) {
    let reads = 0;
    let coercions = 0;
    const part = Object.defineProperty({ type: kind }, kind, {
      enumerable: true,
      get: () => {
        reads++;
        return reads === 1
          ? {
              toString: () => {
                coercions++;
                return 'private';
              },
            }
          : 'valid later';
      },
    });
    assert.throws(() => normalize([part]), TypeError);
    assert.equal(reads, 1);
    assert.equal(coercions, 0);
  }
});
test('capture keeps exact dense part and inherited text/refusal compatibility boundaries', () => {
  assert.deepEqual(normalize([Object.create({ type: 'text', text: 'inherited text' })]), [
    { role: 'assistant', content: 'inherited text' },
  ]);
  for (const content of [
    [],
    new Array(1),
    [null],
    [{ type: 'text', text: 'private', unknown: true }],
    [Object.create({ type: 'refusal', refusal: 'private' })],
    [
      { type: 'refusal', refusal: 'private' },
      { type: 'text', text: '' },
    ],
    [
      { type: 'refusal', refusal: '' },
      { type: 'refusal', refusal: '' },
    ],
  ])
    assert.throws(() => normalize(content), TypeError);
  const original = { type: 'text', text: 'private first' };
  const captured = snapshotChatMessages(normalize([original]));
  original.text = 'private late';
  assert.deepEqual(captured, [{ role: 'assistant', content: 'private first' }]);
});
