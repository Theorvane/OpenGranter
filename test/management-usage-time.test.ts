import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatUsageTime,
  parseUsageUtcInput,
  usageUtcInput,
} from '../src/management/usage-time.ts';

test('UTC controls preserve exact epoch milliseconds and do not use the local zone', () => {
  for (const value of [0, 1, 99, 1709251199123, 253402300799999]) {
    assert.equal(parseUsageUtcInput(usageUtcInput(value)), value);
  }
  assert.equal(parseUsageUtcInput('2024-02-29T23:59'), 1709251140000);
  assert.equal(parseUsageUtcInput('2024-02-29T23:59:59.1'), 1709251199100);
  assert.equal(formatUsageTime(1), '1970-01-01T00:00:00.001Z');
});
test('reject normalized calendars, local zones, negative dates and malformed input', () => {
  for (const value of [
    '',
    '2023-02-29T00:00',
    '2024-04-31T00:00',
    '2024-01-01T24:00',
    '1969-12-31T23:59',
    '2024-01-01',
    '2024-01-01T00:00Z',
    '2024-01-01T00:00+09:00',
    '2024-01-01T00:00:60',
    '2024-01-01T00:00:00.1234',
    ' 2024-01-01T00:00',
  ]) {
    assert.ok(Number.isNaN(parseUsageUtcInput(value)), value);
  }
  assert.equal(usageUtcInput(Number.MAX_SAFE_INTEGER), '');
  assert.equal(formatUsageTime(Number.MAX_SAFE_INTEGER), '9007199254740991 (epoch ms)');
});
