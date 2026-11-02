import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRetryAfterSeconds } from '../src/providers/retry-after.ts';
import {
  probabilityFixture,
  probabilityPrivacy,
  probabilityTools,
} from './nonstream-logprobs-fixture.ts';

const date = 'Sunday, 01-Nov-26 06:30:10 GMT';
const instant = Date.UTC(2026, 10, 1, 6, 30, 10);
for (const delta of [-10000, -9001, -1, 0, 1, 999999])
  test(`RFC850 rounding ${delta}`, () => {
    assert.equal(
      parseRetryAfterSeconds(date, instant + delta),
      Math.max(0, Math.ceil(-delta / 1000)),
    );
  });
for (const value of [
  date.replace('Sunday', 'Monday'),
  date.toLowerCase(),
  `${date} `,
  ` ${date}`,
  `${date}, ${date}`,
  date.replace('01-Nov', '1-Nov'),
  date.replace('-26', '-2026'),
  date.replace('GMT', 'UTC'),
  date.replace('06:30:10', '24:30:10'),
  date.replace('06:30:10', '06:30:60'),
  'Thursday, 29-Feb-26 06:30:10 GMT',
  date.replace('01-Nov', '31-Nov'),
  date.replace('01-Nov', '00-Nov'),
  date.replace(', ', ',  '),
  date.replace('-Nov-', ' Nov '),
  'x'.repeat(1000),
])
  test(`RFC850 rejects ${value.slice(0, 65)}`, () => {
    assert.equal(parseRetryAfterSeconds(value, instant), undefined);
  });
for (const clock of [NaN, Infinity, -Infinity, 8.64e15 + 1, Date.UTC(1500, 0), Date.UTC(10000, 0)])
  test(`RFC850 invalid clock ${clock}`, () => {
    assert.equal(parseRetryAfterSeconds(date, clock), undefined);
    assert.equal(parseRetryAfterSeconds('7', clock), 7);
  });
function rfc850(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string {
  const d = new Date(Date.UTC(year, month, day, hour, minute, second));
  const short = d.toUTCString();
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    d.getUTCDay()
  ];
  return `${weekday}, ${short.slice(5, 7)}-${short.slice(8, 11)}-${short.slice(14, 16)} ${short.slice(17)}`;
}
for (const [year, month, day, clock, expected] of [
  [2076, 10, 1, instant, Math.ceil((Date.UTC(2076, 10, 1) - instant) / 1000)],
  [2028, 1, 29, Date.UTC(2028, 1, 28), 86400],
  [2100, 0, 1, Date.UTC(2099, 11, 31), 86400],
  [2000, 1, 29, Date.UTC(2049, 0, 1), 0],
  [1601, 0, 1, Date.UTC(1650, 0, 1), 0],
  [9999, 11, 31, Date.UTC(9999, 11, 30), 86400],
] as const)
  test(`RFC850 century/calendar ${year}`, () => {
    assert.equal(parseRetryAfterSeconds(rfc850(year, month, day), clock), expected);
  });
test('RFC850 exact 50 years vs one second over uses resolved weekday', () => {
  const clock = Date.UTC(2026, 10, 1, 6, 30, 10);
  assert.equal(
    parseRetryAfterSeconds(rfc850(2076, 10, 1, 6, 30, 10), clock),
    (Date.UTC(2076, 10, 1, 6, 30, 10) - clock) / 1000,
  );
  assert.equal(parseRetryAfterSeconds(rfc850(1976, 10, 1, 6, 30, 11), clock), 0);
  assert.equal(parseRetryAfterSeconds(rfc850(2076, 10, 1, 6, 30, 11), clock), undefined);
});
for (const base of ['/v1', '/api/v1'] as const)
  for (const kind of ['openrouter', 'openai', 'anthropic', 'google'] as const)
    for (const mode of ['nonstream', 'text', 'function'] as const)
      for (const status of [429, 503])
        test(`RFC850 public ${base} ${kind} ${mode} ${status}`, async (t) => {
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
