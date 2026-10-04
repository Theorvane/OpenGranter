import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';
import { type OpenCodeFixtureMode, openCodeGatewayFixture } from './opencode-gateway-fixture.ts';
import {
  type OpenCodeNativeProvider,
  openCodeNativeHasResult,
  openCodeNativeToolNames,
} from './opencode-native-fixture.ts';
import {
  OPENCODE_VERSION,
  openCodeConfig,
  openCodeEnvironment,
  runBoundedProcess,
  runBoundedProcessResult,
} from './opencode-process.ts';

type Event = {
  type: string;
  error?: { data?: { statusCode?: number } };
  part?: {
    text?: string;
    reason?: string;
    tool?: string;
    callID?: string;
    state?: { status?: string; output?: string };
  };
};
const executable = process.argv[2];
if (!executable) throw new Error('Pass the installed OpenCode executable path');
const probes: {
  routeKind: 'delegated' | 'managed';
  provider: OpenCodeNativeProvider;
  mode: OpenCodeFixtureMode;
  googleSignatures: boolean;
}[] = [];
for (const routeKind of ['delegated', 'managed'] as const)
  for (const provider of routeKind === 'managed'
    ? (['openai', 'anthropic', 'google'] as const)
    : (['openai'] as const))
    for (const mode of [
      'text',
      'tools',
      'model-deny',
      'provider-deny',
      'cancel',
      ...(routeKind === 'managed' ? (['followup-deny'] as const) : []),
    ] as const)
      probes.push({ routeKind, provider, mode, googleSignatures: false });
for (const googleSignatures of [false, true])
  probes.push({ routeKind: 'managed', provider: 'google', mode: 'signed-tools', googleSignatures });
for (const { routeKind, provider, mode, googleSignatures } of probes)
  for (const base of ['/v1', '/api/v1']) {
    const toolMode = ['tools', 'followup-deny', 'signed-tools'].includes(mode);
    const signatureLoss = mode === 'signed-tools' && !googleSignatures;
    const root = await realpath(await mkdtemp(join(tmpdir(), 'og-opencode-')));
    const fixture = openCodeGatewayFixture(mode, routeKind, provider);
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
      await runBoundedProcess('git', ['init', '--quiet'], root, env);
      await writeFile(
        join(root, 'opencode.json'),
        JSON.stringify(openCodeConfig(url, toolMode, googleSignatures)),
      );
      await writeFile(join(root, 'fixture.txt'), 'fixture-tool-result');
      const models = await runBoundedProcess(executable, ['models', 'opengranter'], root, env);
      assert.ok(models.includes('opengranter/chat'));
      const args = [
        'run',
        '--pure',
        '--format',
        'json',
        '--model',
        'opengranter/chat',
        'Read the fixture if available and reply',
      ];
      if (signatureLoss) {
        // OpenCode's outer session policy keeps retrying 5xx; bound this compatibility observation.
        await assert.rejects(runBoundedProcessResult(executable, args, root, env, 5000), {
          message: 'External client process failed',
        });
        const continuations = fixture.sent.filter((body) =>
          openCodeNativeHasResult(body, provider),
        );
        assert.ok(continuations.length >= 1);
        assert.ok(
          continuations.every((body) => !JSON.stringify(body).includes('fixture-signature+/==')),
        );
        const failures = fixture.usage.filter((r) => r.outcome === 'failed');
        assert.equal(failures.length, continuations.length);
        assert.ok(failures.every((r) => r.possiblyBilled && r.usage.status === 'missing'));
        assert.equal(fixture.usage.length, fixture.sent.length);
        assert.equal(fixture.counts().authenticated, fixture.sent.length);
        assert.equal(fixture.counts().limits, fixture.sent.length);
        assert.equal(fixture.counts().secrets, fixture.sent.length);
      } else if (mode === 'cancel') {
        await assert.rejects(runBoundedProcessResult(executable, args, root, env, 5000), {
          message: 'External client process failed',
        });
        for (let i = 0; i < 300 && !fixture.usage.length; i++)
          await new Promise((resolve) => setTimeout(resolve, 10));
        assert.ok(fixture.sent.length >= 1);
        assert.equal(fixture.counts().aborted, true);
        assert.ok(
          fixture.usage.some(
            (record) =>
              record.outcome === 'failed' &&
              record.possiblyBilled &&
              record.usage.status === 'missing',
          ),
        );
      } else {
        const result = await runBoundedProcessResult(executable, args, root, env);
        const events = result.output
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Event);
        if (mode === 'model-deny' || mode === 'provider-deny') {
          assert.equal(result.code, 1);
          assert.ok(
            events.some((event) => event.type === 'error' && event.error?.data?.statusCode === 403),
          );
          assert.ok(
            !events.some((event) => event.type === 'step_finish' && event.part?.reason === 'stop'),
          );
          assert.equal(fixture.sent.length, 0);
          assert.equal(fixture.counts().secrets, 0);
          assert.equal(fixture.counts().limits, 0);
          assert.equal(fixture.usage.length, 0);
          assert.ok(fixture.audit.length > 0);
        } else if (mode === 'followup-deny') {
          assert.equal(result.code, 1);
          assert.ok(events.some((e) => e.type === 'error' && e.error?.data?.statusCode === 403));
          assert.ok(!events.some((e) => e.type === 'step_finish' && e.part?.reason === 'stop'));
          assert.ok(
            events.some(
              (e) =>
                e.type === 'tool_use' &&
                e.part?.tool === 'read' &&
                e.part.callID === 'call_read' &&
                e.part.state?.status === 'completed' &&
                e.part.state.output?.includes('fixture-tool-result'),
            ),
          );
          assert.ok(fixture.sent.length >= 1);
          assert.ok(
            fixture.sent.some((body) => openCodeNativeToolNames(body, provider).includes('read')),
          );
          assert.ok(fixture.sent.every((body) => !openCodeNativeHasResult(body, provider)));
          assert.equal(fixture.counts().authenticated, fixture.sent.length + 1);
          assert.equal(fixture.counts().secrets, fixture.sent.length);
          assert.equal(fixture.counts().limits, fixture.sent.length);
          assert.equal(fixture.usage.length, fixture.sent.length);
        } else {
          assert.equal(result.code, 0);
          assert.ok(!events.some((event) => event.type === 'error'));
          assert.ok(
            events.some(
              (event) => event.type === 'text' && event.part?.text === 'fixture-final-answer',
            ),
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
          assert.equal(fixture.counts().authenticated, fixture.sent.length);
          assert.equal(fixture.counts().limits, fixture.sent.length);
          assert.equal(fixture.counts().secrets, fixture.sent.length);
          if (toolMode) {
            assert.ok(
              events.some(
                (event) =>
                  event.type === 'tool_use' &&
                  event.part?.tool === 'read' &&
                  event.part.callID === 'call_read' &&
                  event.part.state?.status === 'completed' &&
                  event.part.state.output?.includes('fixture-tool-result'),
              ),
            );
            const followup = fixture.sent.find((body) => openCodeNativeHasResult(body, provider));
            assert.ok(followup);
            assert.ok(fixture.sent.length >= 2);
            for (const body of fixture.sent)
              if (body.tools) assert.deepEqual(openCodeNativeToolNames(body, provider), ['read']);
            if (googleSignatures)
              assert.ok(
                JSON.stringify(followup).includes('"thoughtSignature":"fixture-signature+/=="'),
              );
          }
        }
      }
      assert.ok(fixture.usage.every((record) => record.routeKind === routeKind));
      if (routeKind === 'managed')
        assert.ok(fixture.usage.every((record) => record.actualInferenceProviderId === provider));
      const metadata = JSON.stringify({ audit: fixture.audit, usage: fixture.usage });
      for (const value of [
        'fixture-final-answer',
        'fixture-upstream-key',
        'fixture-proxy-token',
        'fixture-tool-result',
        'fixture.txt',
        'fixture-partial',
        'fixture-signature+/==',
        'Read the fixture if available and reply',
      ])
        assert.ok(!metadata.includes(value));
      console.log(
        `PASS OpenCode ${OPENCODE_VERSION} ${routeKind}/${provider} ${base}: ${mode}${mode === 'signed-tools' ? (googleSignatures ? ' configured namespace' : ' default namespace') : ''}`,
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
