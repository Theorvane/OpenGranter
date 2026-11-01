import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRetryAfterSeconds } from '../src/providers/retry-after.ts';
import {
  probabilityFixture,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

const date = 'Sun, 01 Nov 2026 06:30:10 GMT';
const instant = Date.parse(date);
for (const [clock, expected] of [
  [instant - 10_000, 10],
  [instant - 9_001, 10],
  [instant - 1, 1],
  [instant, 0],
  [instant + 1, 0],
  [instant + 999_999, 0],
] as const)
  test(`HTTP-date normalization at ${clock}`, () => {
    assert.equal(parseRetryAfterSeconds(date, clock), expected);
  });

for (const value of [
  null,
  '',
  'Mon, 01 Nov 2026 06:30:10 GMT',
  'Sun, 01 Nov 2026 06:30:60 GMT',
  'Sun, 01 Nov 2026 24:30:10 GMT',
  'Thu, 29 Feb 2026 06:30:10 GMT',
  'Sun, 1 Nov 2026 06:30:10 GMT',
  'Sun, 01 Nov 2026 06:30:10 UTC',
  'Sunday, 01-Nov-26 06:30:10 GMT',
  'Mon Nov  1 06:30:10 2026',
  `${date}, ${date}`,
  ` ${date}`,
  `${date} `,
  date.toLowerCase(),
  'Sun, 01 Nov 1500 06:30:10 GMT',
])
  test(`HTTP-date rejects malformed/noncanonical ${value}`, () => {
    assert.equal(parseRetryAfterSeconds(value, instant), undefined);
  });

for (const clock of [Number.NaN, Infinity, -Infinity, 8.64e15 + 1])
  test(`HTTP-date rejects invalid clock ${clock} without changing numeric hints`, () => {
    assert.equal(parseRetryAfterSeconds(date, clock), undefined);
    assert.equal(parseRetryAfterSeconds('0007', clock), 7);
  });

test('HTTP-date leap day and latest canonical year', () => {
  assert.equal(
    parseRetryAfterSeconds('Tue, 29 Feb 2028 00:00:00 GMT', Date.UTC(2028, 1, 28)),
    86400,
  );
  assert.equal(
    parseRetryAfterSeconds('Fri, 31 Dec 9999 23:59:59 GMT', instant),
    Math.ceil((Date.UTC(9999, 11, 31, 23, 59, 59) - instant) / 1000),
  );
});

for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    for (const mode of ['nonstream', 'text', 'function'] as const)
      for (const status of [429, 503])
        test(`HTTP-date public ${base} ${kind} ${mode} ${status}`, async (t) => {
          t.mock.method(Date, 'now', () => instant - 9_001);
          const f = probabilityFixture(kind, undefined, {
            stream: mode !== 'nonstream',
            reply: () =>
              new Response('private fixture-provider-key', {
                status,
                headers: { 'retry-after': date, date: 'Sun, 01 Nov 2099 00:00:00 GMT' },
              }),
          });
          const response = await f.handler(
            f.request(base, {
              ...(mode === 'nonstream' ? {} : { stream: true }),
              ...(mode === 'function' ? { tools: probabilityTools } : {}),
            }),
          );
          assert.equal(response.status, base === '/api/v1' ? status : 502);
          assert.equal(response.headers.get('retry-after'), '10');
          assert.doesNotMatch(await response.text(), /Sun|GMT|2099|private|fixture-provider-key/);
          assert.equal(f.sent.length, 1);
          assert.equal(f.records.length, 1);
          assert.equal(f.records[0]?.outcome, 'failed');
          assert.equal(f.records[0]?.possiblyBilled, true);
          assert.equal(f.records[0]?.usage.status, 'missing');
          assert.doesNotMatch(JSON.stringify([f.records, f.audits]), /Sun|GMT|retry.?after|2099/i);
          probabilityPrivacy(f);
        });
