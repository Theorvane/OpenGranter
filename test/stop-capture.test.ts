import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotStopSequences } from '../src/gateway/chat-parameters.ts';

test('stop capture uses one bounded count', () => {
  let reads = 0;
  const input = new Proxy(['first', 'second', 'third', 'fourth', 'fifth'], {
    get(target, key, receiver) {
      return key === 'length' ? (++reads === 1 ? 1 : 5) : Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(snapshotStopSequences(input), ['first']);
  assert.equal(reads, 1);
  for (const length of [5, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = new Proxy(['first'], {
      get(target, key, receiver) {
        return key === 'length' ? length : Reflect.get(target, key, receiver);
      },
    });
    assert.throws(() => snapshotStopSequences(invalid), TypeError);
  }
});

test('stop capture ignores caller iterators and preserves indexed values', () => {
  const input = ['first', '終\n'];
  let iterations = 0;
  Object.defineProperty(input, Symbol.iterator, {
    value: function* () {
      iterations++;
      yield 'unrelated';
      yield '1';
      yield '2';
      yield '3';
      yield '4';
    },
  });
  assert.deepEqual(snapshotStopSequences(input), ['first', '終\n']);
  assert.equal(iterations, 0);
  const sparse = new Array(1);
  Object.defineProperty(sparse, Symbol.iterator, {
    value: function* () {
      yield 'hidden hole';
    },
  });
  assert.throws(() => snapshotStopSequences(sparse), TypeError);
});

test('stop capture fixes count before indexed getter mutation', () => {
  const input = ['first'];
  let reads = 0;
  Object.defineProperty(input, '0', {
    get() {
      reads++;
      input.push('second', 'third', 'fourth', 'fifth');
      return 'first';
    },
  });
  const captured = snapshotStopSequences(input);
  assert.deepEqual(captured, ['first']);
  assert.equal(reads, 1);
  assert.ok(Object.isFrozen(captured));
});

test('stop capture keeps literal, empty, inherited indexed and invalid-first behavior', () => {
  assert.equal(snapshotStopSequences(null), undefined);
  assert.equal(snapshotStopSequences(undefined), undefined);
  assert.equal(snapshotStopSequences('終\n'), '終\n');
  assert.deepEqual(snapshotStopSequences([]), []);
  assert.deepEqual(snapshotStopSequences(['', '2', '3', '4']), ['', '2', '3', '4']);
  const inherited = new Array(1);
  Object.setPrototypeOf(
    inherited,
    Object.assign(Object.create(Array.prototype), { 0: 'inherited' }),
  );
  assert.deepEqual(snapshotStopSequences(inherited), ['inherited']);
  let reads = 0;
  const malformed = ['first'];
  Object.defineProperty(malformed, '0', {
    get() {
      return ++reads === 1 ? 42 : 'later';
    },
  });
  assert.throws(() => snapshotStopSequences(malformed), TypeError);
  assert.equal(reads, 1);
});
