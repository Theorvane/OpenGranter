import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('offline compatibility command verifies chat and supported model-query pins', () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/check-openrouter-schema.ts'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'PASS pinned OpenRouter request schema integrity\nPASS pinned OpenRouter model-query schema integrity\n',
  );
  assert.equal(result.stderr, '');
});

const root = new URL('../', import.meta.url);
const scriptNames = [
  'check-openrouter-schema.ts',
  'openrouter-schema.ts',
  'openrouter-model-query-schema.ts',
];
const pinNames = ['openrouter-request-schema.json', 'openrouter-model-query-schema.json'];
const safeFailure = 'FAIL OpenRouter schema check unavailable or invalid; no pin changed\n';
async function controlledLive(mode: string) {
  const directory = await mkdtemp(join(tmpdir(), 'opengranter-model-drift-'));
  try {
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'contracts'));
    for (const name of scriptNames)
      await copyFile(new URL(`scripts/${name}`, root), join(directory, 'scripts', name));
    const originals = await Promise.all(
      pinNames.map((name) => readFile(new URL(`contracts/${name}`, root), 'utf8')),
    );
    const [chatRaw, modelRaw] = originals;
    assert.ok(chatRaw && modelRaw);
    const chatPin = JSON.parse(chatRaw);
    const modelPin = JSON.parse(modelRaw);
    const p = chatPin.projection;
    const schemas = {
      ...p.definitions,
      ...p.streamDefinitions,
      ...p.reasoningDefinitions,
      ...p.usageDefinitions,
      ...p.responseDefinitions,
      ChatRequest: { type: 'object', required: p.required, properties: p.fields },
    };
    for (const [name, entry] of Object.entries(p.messageNames)) {
      const item = entry as { schema: object; required: boolean };
      const message = schemas[name];
      message.properties.name = item.schema;
      message.required = (message.required ?? []).filter((key: string) => key !== 'name');
      if (item.required) message.required.push('name');
    }
    schemas.ChatAssistantMessage.properties.tool_calls = p.toolMessages.ChatAssistantMessage.schema;
    schemas.ChatToolMessage = p.toolMessages.ChatToolMessage;
    const source = {
      openapi: p.openapi,
      info: { version: p.documentVersion },
      paths: {
        '/chat/completions': {
          post: {
            requestBody: { content: { 'application/json': { schema: { $ref: p.requestRef } } } },
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: p.responseRef } } } },
            },
          },
        },
        '/models': {
          get: {
            operationId: modelPin.projection.operationId,
            parameters: Object.values(modelPin.projection.parameters),
          },
        },
      },
      components: { schemas },
    };
    if (mode === 'model-drift' || mode === 'both-drift')
      modelPin.projection.parameters.context.schema.minimum = 2;
    if (mode === 'chat-drift' || mode === 'both-drift')
      schemas.ChatRequest.properties.user = { type: 'integer' };
    if (mode === 'invalid-model-pin') modelPin.version = 0;
    if (mode === 'invalid-chat-pin') chatPin.version = 0;
    if (mode === 'invalid-model-source') source.paths['/models'].get.parameters = [];
    // The downloaded source was constructed before drift mutations, and shares the selected objects.
    await writeFile(join(directory, 'source.json'), JSON.stringify(source));
    const pins =
      mode === 'invalid-model-pin'
        ? [chatRaw, JSON.stringify(modelPin)]
        : mode === 'invalid-chat-pin'
          ? [JSON.stringify(chatPin), modelRaw]
          : originals;
    for (let i = 0; i < pinNames.length; i++) {
      const name = pinNames[i];
      const raw = pins[i];
      assert.ok(name && raw);
      await writeFile(join(directory, 'contracts', name), raw);
    }
    const script = join(directory, 'scripts', scriptNames[0] ?? '');
    const setup = `import fs from 'node:fs';
      let count=0;
      globalThis.fetch=async (url, init)=> {
        count++; fs.writeFileSync(${JSON.stringify(join(directory, 'calls.json'))}, JSON.stringify({count,url,redirect:init.redirect,credentials:init.credentials,headers:init.headers??null}));
        if (${JSON.stringify(mode)}==='transport-error') throw new Error('private downloaded content and credentials');
        return new Response(fs.readFileSync(${JSON.stringify(join(directory, 'source.json'))}), {status:200});
      };
      process.argv=[process.execPath,${JSON.stringify(script)},'--live'];
      await import(${JSON.stringify(pathToFileURL(script).href)});`;
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', setup],
      { encoding: 'utf8', timeout: 5000 },
    );
    const calls = await readFile(join(directory, 'calls.json'), 'utf8').then(JSON.parse, () => ({
      count: 0,
    }));
    for (let i = 0; i < pinNames.length; i++) {
      const name = pinNames[i];
      assert.ok(name);
      assert.equal(await readFile(join(directory, 'contracts', name), 'utf8'), pins[i]);
    }
    if (calls.count)
      assert.deepEqual(calls, {
        count: 1,
        url: 'https://openrouter.ai/openapi.json',
        redirect: 'error',
        credentials: 'omit',
        headers: null,
      });
    assert.equal(`${result.stdout}${result.stderr}`.includes('private'), false);
    return { result, calls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('live compatibility validates both pins against one bounded credential-free download', async () => {
  const { result, calls } = await controlledLive('unchanged');
  assert.equal(result.status, 0);
  assert.equal(calls.count, 1);
  assert.equal(
    result.stdout,
    'PASS selected OpenRouter request schema unchanged\nPASS selected OpenRouter model-query schema unchanged\n',
  );
  assert.equal(result.stderr, '');
});
for (const mode of ['model-drift', 'chat-drift', 'both-drift'])
  test(`live ${mode} reports the selected subset and preserves both pins`, async () => {
    const { result, calls } = await controlledLive(mode);
    assert.equal(result.status, 1);
    assert.equal(calls.count, 1);
    const chatDrift = mode !== 'model-drift';
    const modelDrift = mode !== 'chat-drift';
    assert.equal(
      result.stdout,
      `${chatDrift ? '' : 'PASS selected OpenRouter request schema unchanged\n'}${modelDrift ? '' : 'PASS selected OpenRouter model-query schema unchanged\n'}`,
    );
    assert.equal(
      result.stderr,
      `${chatDrift ? 'FAIL selected OpenRouter request schema drift; review the pin and contracts\n' : ''}${modelDrift ? 'FAIL selected OpenRouter model-query schema drift; review the pin and contracts\n' : ''}`,
    );
  });
test('live transport failures expose only the safe fixed diagnostic and do not write pins', async () => {
  const { result } = await controlledLive('transport-error');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, safeFailure);
});
for (const mode of ['invalid-model-pin', 'invalid-chat-pin'])
  test(`live ${mode} rejects before fetching or reporting success`, async () => {
    const { result, calls } = await controlledLive(mode);
    assert.equal(result.status, 1);
    assert.equal(calls.count, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, safeFailure);
  });
test('malformed selected model source withholds all success output and preserves pins', async () => {
  const { result, calls } = await controlledLive('invalid-model-source');
  assert.equal(result.status, 1);
  assert.equal(calls.count, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, safeFailure);
});
