import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { openCodeGatewayFixture } from './opencode-gateway-fixture.ts';
import {
  OPENCODE_VERSION,
  openCodeConfig,
  openCodeEnvironment,
  runBoundedProcess,
} from './opencode-process.ts';

const executable = process.argv[2];
if (!executable) throw new Error('Pass the installed OpenCode executable path');
for (const base of ['/v1', '/api/v1']) {
  const root = await mkdtemp(join(tmpdir(), 'og-opencode-'));
  const fixture = openCodeGatewayFixture();
  const server = createNodeChatServer(fixture.ports);
  try {
    const env = openCodeEnvironment(root, 'fixture-proxy-token');
    assert.equal(
      (await runBoundedProcess(executable, ['--version'], root, env)).trim(),
      OPENCODE_VERSION,
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`;
    await writeFile(join(root, 'opencode.json'), JSON.stringify(openCodeConfig(url)));
    const models = await runBoundedProcess(executable, ['models', 'opengranter'], root, env);
    assert.ok(models.includes('opengranter/chat'));
    const output = await runBoundedProcess(
      executable,
      [
        'run',
        '--pure',
        '--format',
        'json',
        '--model',
        'opengranter/chat',
        'Reply with the fixture answer',
      ],
      root,
      env,
    );
    const events = output
      .trim()
      .split('\n')
      .map(
        (line) => JSON.parse(line) as { type: string; part?: { text?: string; reason?: string } },
      );
    assert.ok(
      events.some((event) => event.type === 'text' && event.part?.text === 'fixture-final-answer'),
    );
    assert.ok(
      events.some((event) => event.type === 'step_finish' && event.part?.reason === 'stop'),
    );
    assert.ok(fixture.sent.length >= 1);
    assert.equal(fixture.usage.length, fixture.sent.length);
    assert.ok(
      fixture.usage.every(
        (record) => record.outcome === 'succeeded' && record.usage.totalTokens === 5,
      ),
    );
    assert.equal(fixture.counts().secrets, fixture.sent.length);
    const metadata = JSON.stringify({ audit: fixture.audit, usage: fixture.usage });
    for (const value of [
      'fixture-final-answer',
      'fixture-upstream-key',
      'fixture-proxy-token',
      'Reply with the fixture answer',
    ])
      assert.ok(!metadata.includes(value));
    console.log(
      `PASS OpenCode ${OPENCODE_VERSION} ${base}: configured model selection and text streaming`,
    );
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    await rm(root, { recursive: true, force: true });
  }
}
