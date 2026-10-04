import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';
import { createDirectAnthropicFunctionStreamInvoker } from './direct-anthropic-function-stream.ts';
import { type DirectChatPorts, snapshotDirectProviderRegistrations } from './direct-chat.ts';
import { createDirectOpenAIFunctionStreamInvoker } from './direct-openai-function-stream.ts';

/** Dispatch only captured administrator registrations after managed authorization. */
export function createRegisteredDirectFunctionStreamInvoker(
  ports: DirectChatPorts,
): ReturnType<typeof createDirectOpenAIFunctionStreamInvoker> {
  const registrations = snapshotDirectProviderRegistrations(ports.registrations).map(
    (registration) => Object.freeze(registration),
  );
  const fixedPorts = { ...ports, registrations: Object.freeze(registrations) };
  const openai = createDirectOpenAIFunctionStreamInvoker(fixedPorts),
    anthropic = createDirectAnthropicFunctionStreamInvoker(fixedPorts);
  const kinds = new Map(
    registrations.map((registration) => [registration.providerId, registration.kind]),
  );
  return (candidate, request, onDelta, signal) => {
    const fixed = Object.freeze({
      id: candidate.id,
      kind: candidate.kind,
      providerId: candidate.providerId,
      upstreamModelId: candidate.upstreamModelId,
    });
    const kind = kinds.get(fixed.providerId);
    if (kind === 'openai') return openai(fixed, request, onDelta, signal);
    if (kind === 'anthropic') return anthropic(fixed, request, onDelta, signal);
    return Promise.reject(new DirectProviderFailure('other', false, false));
  };
}
