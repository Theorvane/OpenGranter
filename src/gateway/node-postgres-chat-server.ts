import type { Server } from 'node:http';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  createPostgresChatHandler,
  type PostgresChatHandlerPorts,
} from './postgres-chat-handler.ts';
import {
  createPostgresDirectChatHandler,
  type PostgresDirectChatHandlerPorts,
} from './postgres-direct-chat-handler.ts';

/** Build an unbound PostgreSQL-backed server; the caller owns listen, close, and connections. */
export function createNodePostgresChatServer<T>(ports: PostgresChatHandlerPorts<T>): Server {
  return createNodeRequestServer(createPostgresChatHandler(ports));
}

/** Load enabled direct registrations and return an unbound server. */
export async function createNodePostgresDirectChatServer(
  ports: PostgresDirectChatHandlerPorts,
): Promise<Server> {
  return createNodeRequestServer(await createPostgresDirectChatHandler(ports));
}
