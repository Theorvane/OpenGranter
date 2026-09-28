import type { Server } from 'node:http';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  createPostgresDualRouteChatHandler,
  type PostgresDualRouteChatHandlerPorts,
} from './postgres-dual-chat-handler.ts';

/** Return an unbound dual-route server; the caller owns listening and DB lifecycle. */
export async function createNodePostgresDualRouteChatServer(
  ports: PostgresDualRouteChatHandlerPorts,
): Promise<Server> {
  return createNodeRequestServer(await createPostgresDualRouteChatHandler(ports));
}
