import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type PostgresDualRouteGatewayRuntimePorts,
  startPostgresDualRouteGateway,
} from './postgres-gateway-runtime.ts';

export type GatewayBootstrapPorts = Omit<
  PostgresDualRouteGatewayRuntimePorts,
  'host' | 'port' | 'now' | 'newRequestId'
>;

interface ServiceConfig {
  readonly modulePath: string;
  readonly host: string;
  readonly port: number;
  readonly shutdownMs: number;
}

/** Only deployment configuration, never request input. Validate before importing code. */
export function parseGatewayServiceConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const modulePath = env.OPENGRANTER_BOOTSTRAP_MODULE;
  const host = env.OPENGRANTER_HOST ?? '127.0.0.1';
  const portText = env.OPENGRANTER_PORT ?? '8080';
  const shutdownText = env.OPENGRANTER_SHUTDOWN_MS ?? '30000';
  const port = Number(portText);
  const shutdownMs = Number(shutdownText);
  if (
    !modulePath ||
    !isAbsolute(modulePath) ||
    modulePath.includes('\0') ||
    !host ||
    host.length > 253 ||
    /\s|\0/u.test(host) ||
    !/^[0-9]+$/u.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[0-9]+$/u.test(shutdownText) ||
    !Number.isInteger(shutdownMs) ||
    shutdownMs < 1 ||
    shutdownMs > 2147483647
  )
    throw new Error('Gateway configuration invalid');
  return { modulePath, host, port, shutdownMs };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isBootstrapPorts(value: unknown): value is GatewayBootstrapPorts {
  return (
    isObject(value) &&
    ['openConnection', 'resolveSecret', 'checkLimit'].every(
      (key) => typeof value[key] === 'function',
    )
  );
}

interface ServiceOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly signals: Pick<EventEmitter, 'on' | 'removeListener'>;
  readonly report: (message: string) => void;
  readonly exit: (code: number) => void;
  readonly loadModule?: (url: string) => Promise<unknown>;
  readonly start?: (ports: PostgresDualRouteGatewayRuntimePorts) => Promise<{
    readonly close: () => Promise<void>;
  }>;
}

/** Dedicated process boundary. exit must terminate the process in production. */
export async function runGatewayService(options: ServiceOptions): Promise<void> {
  let config: ServiceConfig;
  try {
    config = parseGatewayServiceConfig(options.env);
  } catch {
    options.report('Gateway configuration invalid');
    options.exit(1);
    return;
  }
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => {}, 2147483647);
    let stopping = false;
    let finished = false;
    let closing = false;
    let runtime: { readonly close: () => Promise<void> } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number, message?: string) => {
      if (finished) return;
      finished = true;
      clearInterval(keepAlive);
      if (timer) clearTimeout(timer);
      options.signals.removeListener('SIGTERM', stop);
      options.signals.removeListener('SIGINT', stop);
      if (message) options.report(message);
      resolve();
      options.exit(code);
    };
    const close = async () => {
      if (!runtime || closing || finished) return;
      closing = true;
      try {
        await runtime.close();
        finish(0);
      } catch {
        finish(1, 'Gateway shutdown unavailable');
      }
    };
    const stop = () => {
      if (stopping || finished) return;
      stopping = true;
      // Keep referenced: a stalled promise alone does not keep Node running.
      timer = setTimeout(() => finish(1, 'Gateway shutdown deadline exceeded'), config.shutdownMs);
      void close();
    };
    options.signals.on('SIGTERM', stop);
    options.signals.on('SIGINT', stop);
    void (async () => {
      try {
        const module: unknown = await (options.loadModule ?? ((url) => import(url)))(
          pathToFileURL(config.modulePath).href,
        );
        if (finished) return;
        if (stopping) {
          finish(0);
          return;
        }
        if (!isObject(module) || typeof module.createGatewayPorts !== 'function') {
          throw new Error('Invalid bootstrap');
        }
        const ports: unknown = await module.createGatewayPorts();
        if (finished) return;
        if (stopping) {
          finish(0);
          return;
        }
        if (!isBootstrapPorts(ports)) throw new Error('Invalid bootstrap');
        runtime = await (options.start ?? startPostgresDualRouteGateway)({
          ...ports,
          host: config.host,
          port: config.port,
          now: Date.now,
          newRequestId: randomUUID,
        });
        if (finished) {
          await runtime.close();
          return;
        }
        if (stopping) {
          await close();
          return;
        }
        options.report('Gateway listening');
      } catch {
        finish(1, 'Gateway startup unavailable');
      }
    })();
  });
}
