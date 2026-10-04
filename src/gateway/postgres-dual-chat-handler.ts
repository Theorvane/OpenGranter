import { createOpenRouterChatInvoker } from '../providers/openrouter-chat.ts';
import { createOpenRouterFunctionStreamInvoker } from '../providers/openrouter-function-stream.ts';
import { createOpenRouterTextStreamInvoker } from '../providers/openrouter-stream.ts';
import { createPostgresOpenRouterProviderMappingResolver } from '../providers/postgres-openrouter-mappings.ts';
import {
  createPostgresDirectChatHandler,
  type PostgresDirectChatHandlerPorts,
} from './postgres-direct-chat-handler.ts';

export interface PostgresDualRouteChatHandlerPorts
  extends Omit<
    PostgresDirectChatHandlerPorts,
    | 'invokeOpenRouter'
    | 'invokeOpenRouterTextStream'
    | 'invokeOpenRouterFunctionStream'
    | 'resolveVerifiedProviderSlug'
  > {}

/** Compose both stored route kinds; caller owns migrations, secrets, limits, and resources. */
export async function createPostgresDualRouteChatHandler(
  ports: PostgresDualRouteChatHandlerPorts,
): Promise<(request: Request) => Promise<Response>> {
  const { resolveSecret, fetcher, timeoutMs } = ports;
  const upstreamPorts = {
    resolveSecret,
    ...(fetcher === undefined ? {} : { fetcher }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  return createPostgresDirectChatHandler({
    ...ports,
    resolveVerifiedProviderSlug: createPostgresOpenRouterProviderMappingResolver(ports.client),
    invokeOpenRouter: (credentialRef, attempt, request) =>
      createOpenRouterChatInvoker({ ...upstreamPorts, credentialRef })(attempt, request),
    invokeOpenRouterFunctionStream: (credentialRef, attempt, request, onDelta, signal) =>
      createOpenRouterFunctionStreamInvoker({ ...upstreamPorts, credentialRef })(
        attempt,
        request,
        onDelta,
        signal,
      ),
    invokeOpenRouterTextStream: (credentialRef, attempt, request, onDelta, signal) =>
      createOpenRouterTextStreamInvoker({ ...upstreamPorts, credentialRef })(
        attempt,
        request,
        onDelta,
        signal,
      ),
  });
}
