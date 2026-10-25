import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ChatHandlerPorts } from '../src/gateway/chat-handler.ts';
import { createNodeChatServer } from '../src/gateway/node-chat-server.ts';

export async function withAiSdkServer<T>(
  ports: ChatHandlerPorts<unknown>,
  base: '/v1' | '/api/v1',
  token: string,
  run: (model: ReturnType<ReturnType<typeof createOpenRouter>['chat']>) => Promise<T>,
  observeResponse?: (response: Response) => Promise<void>,
): Promise<T> {
  const server = createNodeChatServer(ports);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let requests = 0;
    const provider = createOpenRouter({
      apiKey: token,
      baseURL: `${origin}${base}`,
      fetch: async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        assert.equal(url.origin, origin);
        assert.equal(url.pathname, `${base}/chat/completions`);
        assert.ok(++requests <= 3, 'Unexpected automatic client retries');
        const response = await fetch(input, init);
        if (observeResponse) await observeResponse(response.clone());
        return response;
      },
    });
    return await run(provider.chat('chat'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
export function aiSdkPrivacy(audit: unknown, usage: unknown): void {
  assert.doesNotMatch(
    JSON.stringify([audit, usage]),
    /fixture-(?:proxy|upstream|provider)-(?:token|key)|fixture-tool-result|fixture-final-answer|private prompt|filePath|fixture\.txt/u,
  );
}
