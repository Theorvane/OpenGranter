import type { Server } from 'node:http';
import { type ChatHandlerPorts, createChatHandler } from './chat-handler.ts';
import { createNodeRequestServer } from './node-request-server.ts';

/** Preserve the gateway-port factory through the shared Node socket bridge. */
export function createNodeChatServer<T>(ports: ChatHandlerPorts<T>): Server {
  return createNodeRequestServer(createChatHandler(ports));
}
