import type { GatewayAuditEvent } from '../gateway/chat-handler.ts';
import {
  type ClientErrorCode,
  type ClientErrorFormat,
  createClientErrorResponse,
} from '../gateway/client-errors.ts';
import type { DelegatedRouteAuditEvent } from '../routing/invoke-delegated-route.ts';
import {
  type DelegatedTextStreamInput,
  type DelegatedTextStreamResult,
  invokeDelegatedTextStream,
  type StreamChunkIdentity,
} from './invoke-delegated-text-stream.ts';

interface HttpStreamInput extends Omit<DelegatedTextStreamInput, 'onFrame' | 'ports' | 'signal'> {
  readonly signal: AbortSignal;
  readonly format: ClientErrorFormat;
  readonly ports: Omit<DelegatedTextStreamInput['ports'], 'writeAudit'> & {
    readonly writeAudit: (event: GatewayAuditEvent | DelegatedRouteAuditEvent) => Promise<void>;
  };
}

function failure(result: Exclude<DelegatedTextStreamResult, { status: 'invoked' }>): {
  status: number;
  code: ClientErrorCode;
} {
  switch (result.reason) {
    case 'no-candidates':
      return { status: 403, code: 'forbidden' };
    case 'limit':
      return { status: 429, code: 'limit_exceeded' };
    case 'upstream-failed':
      return { status: 502, code: 'upstream_failed' };
    case 'credential-unavailable':
      return { status: 503, code: 'credential_unavailable' };
    case 'usage-unavailable':
      return { status: 503, code: 'usage_unavailable' };
    case 'audit-unavailable':
      return { status: 503, code: 'audit_unavailable' };
    default:
      return { status: 503, code: 'route_unavailable' };
  }
}

/** Stream one controlled delegated attempt with a bounded, awaited HTTP body handoff. */
export function createDelegatedHttpStreamResponse(input: HttpStreamInput): Promise<Response> {
  const writeUsage = input.ports.writeUsage;
  const cancellation = new AbortController();
  const encoder = new TextEncoder();
  let resolveResponse!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let pending:
    | { bytes: Uint8Array; resolve: () => void; reject: (error: Error) => void }
    | undefined;
  let demand = false;
  let closed = false;
  let started = false;
  let upstreamCompleted = false;
  let interruption: Promise<boolean> | undefined;
  let delivered: StreamChunkIdentity | undefined;

  function flush() {
    if (!demand || !pending || closed) return;
    const frame = pending;
    pending = undefined;
    demand = false;
    controller.enqueue(frame.bytes);
    frame.resolve();
  }
  function abort() {
    cancellation.abort();
    pending?.reject(new Error('Client stream unavailable'));
    pending = undefined;
    if (!closed) {
      closed = true;
      controller.error(new Error('Client stream unavailable'));
    }
  }
  const body = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      pull() {
        demand = true;
        flush();
      },
      cancel() {
        closed = true;
        abort();
      },
    },
    { highWaterMark: 0 },
  );
  input.signal.addEventListener('abort', abort, { once: true });
  if (input.signal.aborted) abort();

  async function send(frame: string) {
    if (closed || cancellation.signal.aborted) throw new Error('Client stream unavailable');
    if (!started) {
      started = true;
      resolveResponse(
        new Response(body, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            'x-request-id': input.requestId,
          },
        }),
      );
    }
    await new Promise<void>((resolve, reject) => {
      pending = { bytes: encoder.encode(frame), resolve, reject };
      flush();
    });
  }
  function interrupted(): Promise<boolean> {
    interruption ??= recordInterruption();
    return interruption;
  }
  async function recordInterruption(): Promise<boolean> {
    try {
      await input.ports.writeAudit({
        kind: 'stream-interrupted',
        principalId: input.principalId,
        credentialId: input.credentialId,
        policyVersions: input.policyVersions,
        requestId: input.requestId,
        routeVersion: input.routeVersion,
        modelAlias: input.modelAlias,
        outcome: cancellation.signal.aborted ? 'cancelled' : 'failed',
        upstreamCompleted,
      });
      return true;
    } catch {
      return false;
    }
  }
  async function fail(status: number, code: ClientErrorCode, recordInterruption: boolean) {
    if (recordInterruption && !(await interrupted())) {
      status = 503;
      code = 'audit_unavailable';
    }
    const error = createClientErrorResponse(status, code, input.requestId, input.format);
    if (!started) {
      resolveResponse(error);
      return;
    }
    if (!closed) {
      if (input.format === 'openrouter' && delivered) {
        const payload: unknown = await error.json();
        if (typeof payload !== 'object' || payload === null || !('error' in payload))
          throw new Error('Invalid client error payload');
        await send(
          `data: ${JSON.stringify({
            ...delivered,
            object: 'chat.completion.chunk',
            error: payload.error,
            request_id: input.requestId,
            choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
          })}\n\n`,
        );
      } else await send(`data: ${await error.text()}\n\n`);
    }
  }
  async function run() {
    try {
      const result = await invokeDelegatedTextStream({
        ...input,
        signal: cancellation.signal,
        onFrame: async (frame, identity) => {
          await send(frame);
          delivered = identity;
        },
        ports: {
          ...input.ports,
          ...(writeUsage
            ? {
                writeUsage: async (record) => {
                  if (record.outcome === 'succeeded') upstreamCompleted = true;
                  await writeUsage(record);
                },
              }
            : {}),
        },
      });
      if (result.status === 'invoked') {
        upstreamCompleted = true;
        try {
          for (const frame of result.finalFrames) await send(frame);
        } catch {
          await interrupted();
        }
      } else {
        const error = failure(result);
        await fail(error.status, error.code, started || cancellation.signal.aborted);
      }
    } catch {
      await fail(503, 'route_unavailable', true).catch(() => {});
    } finally {
      input.signal.removeEventListener('abort', abort);
      if (!closed) {
        closed = true;
        controller.close();
      }
    }
  }
  void run();
  return response;
}
