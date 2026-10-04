import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';
import { createDirectAnthropicTextStreamInvoker } from './direct-anthropic-stream.ts';
import { type DirectChatPorts, snapshotDirectProviderRegistrations } from './direct-chat.ts';
import { createDirectOpenAITextStreamInvoker } from './direct-openai-stream.ts';

/** Dispatch only captured administrator registrations after managed authorization. */
export function createRegisteredDirectTextStreamInvoker(
  ports: DirectChatPorts,
): ReturnType<typeof createDirectOpenAITextStreamInvoker> {
  const registrations = snapshotDirectProviderRegistrations(ports.registrations).map(
    (registration) => Object.freeze(registration),
  );
  const fixedPorts = { ...ports, registrations: Object.freeze(registrations) };
  const openai = createDirectOpenAITextStreamInvoker(fixedPorts),
    anthropic = createDirectAnthropicTextStreamInvoker(fixedPorts);
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
