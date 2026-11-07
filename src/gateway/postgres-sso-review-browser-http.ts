import type { Server } from 'node:http';
import { createManagementBrowserHandler } from '../management/browser-http.ts';
import { createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  createPostgresSsoReviewHandler,
  type PostgresSsoReviewHttpPorts,
} from './postgres-sso-review-http.ts';

export interface PostgresSsoReviewBrowserPorts extends PostgresSsoReviewHttpPorts {
  /** Caller-owned, reviewed PUBLIC build artifact. Never credentials or user HTML. */
  readonly javascript: string;
}

/** Source-only static/read-only API composition, not a browser session or runtime.
 * Public assets grant no authority. Private requests retain the existing fresh
 * registered-key SSO/IAM and durable audit. No cookies, token bridge or writes.
 */
export function createPostgresSsoReviewBrowserHandler(ports: PostgresSsoReviewBrowserPorts) {
  return createManagementBrowserHandler({
    javascript: ports.javascript,
    application: createPostgresSsoReviewHandler(ports),
  });
}

/** Unbound only. Caller owns public artifact, SQL lifecycle/schema promotion,
 * listen/TLS/ingress and any separately approved trusted session adapter.
 */
export function createPostgresSsoReviewBrowserServer(ports: PostgresSsoReviewBrowserPorts): Server {
  return createNodeRequestServer(createPostgresSsoReviewBrowserHandler(ports), () => {
    const response = createClientErrorResponse(503, 'internal_error');
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  });
}
