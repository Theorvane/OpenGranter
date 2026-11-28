import { z } from 'zod';
import { validOpenRouterSlug } from '../providers/openrouter-chat.ts';

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u);
const reference = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[^\s\p{Cc}]+$/u);
const providerSchema = z.strictObject({
  id,
  kind: z.enum(['openai', 'anthropic', 'google', 'openrouter']),
  origin: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
      } catch {
        return false;
      }
    }),
  credentialRef: reference,
});
const candidateSchema = z.strictObject({
  id,
  transportProviderId: id,
  providerId: id,
  upstreamModelId: id,
  providerSlug: id.nullable(),
  priority: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
});
const researchSchema = z.strictObject({
  enabled: z.literal(false),
  environment: z.literal('research'),
  sharePrompt: z.boolean(),
});
const configurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providers: z.array(providerSchema).min(1).max(128),
  routes: z
    .array(
      z.strictObject({
        id,
        alias: id,
        strategy: z.literal('administrator-priority'),
        candidates: z.array(candidateSchema).min(1).max(128),
        research: researchSchema.default({
          enabled: false,
          environment: 'research',
          sharePrompt: false,
        }),
      }),
    )
    .min(1)
    .max(128),
});
const registrySchema = z.strictObject({
  version: id,
  providers: z.array(providerSchema).max(128),
  mappings: z
    .array(
      z.strictObject({
        alias: id,
        transportProviderId: id,
        providerId: id,
        upstreamModelId: id,
        providerSlug: id.nullable(),
        verified: z.literal(true),
      }),
    )
    .max(16384),
});
export type OwnedConfiguration = z.infer<typeof configurationSchema>;
export type ApprovedConfigurationRegistry = z.infer<typeof registrySchema>;
export const validConfigurationId = (value: unknown): value is string =>
  id.safeParse(value).success;
export const revisionNumber = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const generationNumber = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);

export class InvalidOwnedConfiguration extends Error {
  constructor() {
    super('Invalid owned configuration');
    this.name = 'InvalidOwnedConfiguration';
  }
}
export function parseOwnedConfiguration(value: unknown): OwnedConfiguration {
  const result = configurationSchema.safeParse(value);
  if (!result.success) throw new InvalidOwnedConfiguration();
  const configuration = result.data;
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  if (
    !unique(configuration.providers.map((item) => item.id)) ||
    !unique(configuration.routes.map((item) => item.id)) ||
    !unique(configuration.routes.map((item) => item.alias))
  )
    throw new InvalidOwnedConfiguration();
  for (const route of configuration.routes) {
    if (
      !unique(route.candidates.map((item) => item.id)) ||
      !unique(
        route.candidates.map((item) =>
          JSON.stringify([item.transportProviderId, item.providerId, item.upstreamModelId]),
        ),
      )
    )
      throw new InvalidOwnedConfiguration();
    for (const candidate of route.candidates) {
      const provider = configuration.providers.find(
        (item) => item.id === candidate.transportProviderId,
      );
      if (
        !provider ||
        (provider.kind === 'openrouter'
          ? !validOpenRouterSlug(candidate.providerSlug) ||
            !validOpenRouterSlug(candidate.upstreamModelId)
          : candidate.providerSlug !== null || candidate.providerId !== provider.id)
      )
        throw new InvalidOwnedConfiguration();
    }
  }
  return configuration;
}

/** Registry is trusted deployment input, never a request-body attestation. */
export function attestOwnedConfiguration(
  configuration: OwnedConfiguration,
  input: unknown,
): string {
  const parsed = registrySchema.safeParse(input);
  if (!parsed.success) throw new Error('Configuration registry unavailable');
  const registry = parsed.data;
  if (
    new Set(registry.providers.map((item) => item.id)).size !== registry.providers.length ||
    new Set(
      registry.mappings.map((item) =>
        JSON.stringify([
          item.alias,
          item.transportProviderId,
          item.providerId,
          item.upstreamModelId,
        ]),
      ),
    ).size !== registry.mappings.length
  )
    throw new Error('Configuration registry unavailable');
  for (const provider of configuration.providers) {
    if (
      !registry.providers.some(
        (approved) =>
          approved.id === provider.id &&
          approved.kind === provider.kind &&
          approved.origin === provider.origin &&
          approved.credentialRef === provider.credentialRef,
      )
    )
      throw new InvalidOwnedConfiguration();
  }
  for (const route of configuration.routes)
    for (const candidate of route.candidates) {
      if (
        !registry.mappings.some(
          (mapping) =>
            mapping.alias === route.alias &&
            mapping.transportProviderId === candidate.transportProviderId &&
            mapping.providerId === candidate.providerId &&
            mapping.upstreamModelId === candidate.upstreamModelId &&
            mapping.providerSlug === candidate.providerSlug,
        )
      )
        throw new InvalidOwnedConfiguration();
    }
  return registry.version;
}
