import {
  type ChatCompletion,
  createDirectChatInvoker,
  type DirectChatPorts,
} from '../providers/direct-chat.ts';
import { createDirectOpenAITextStreamInvoker } from '../providers/direct-openai-stream.ts';
import { createPostgresDirectProviderRegistrationReader } from '../providers/postgres-direct-providers.ts';
import {
  createPostgresChatHandler,
  type PostgresChatHandlerPorts,
} from './postgres-chat-handler.ts';

export interface PostgresDirectChatHandlerPorts
  extends Omit<PostgresChatHandlerPorts<ChatCompletion>, 'invokeDirect' | 'invokeDirectTextStream'>,
    Pick<DirectChatPorts, 'fetcher' | 'timeoutMs'> {}

/** Load one configuration snapshot; caller owns migrations, secrets, and resource lifecycle. */
export async function createPostgresDirectChatHandler(
  ports: PostgresDirectChatHandlerPorts,
): Promise<(request: Request) => Promise<Response>> {
  const { fetcher, timeoutMs, ...gateway } = ports;
  const registrations = await createPostgresDirectProviderRegistrationReader(ports.client)();
  const upstreamPorts = {
    registrations,
    resolveSecret: ports.resolveSecret,
    ...(fetcher === undefined ? {} : { fetcher }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  return createPostgresChatHandler({
    ...gateway,
    invokeDirect: createDirectChatInvoker(upstreamPorts),
    invokeDirectTextStream: createDirectOpenAITextStreamInvoker(upstreamPorts),
  });
}
