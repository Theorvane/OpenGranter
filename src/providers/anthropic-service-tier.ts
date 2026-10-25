/** Provider-reported metadata only; never infer a tier from request options or counters. */
export function snapshotAnthropicServiceTier(usage: unknown): string | null | undefined {
  if (
    typeof usage !== 'object' ||
    usage === null ||
    Array.isArray(usage) ||
    !Object.hasOwn(usage, 'service_tier')
  )
    return undefined;
  const tier: unknown = Reflect.get(usage, 'service_tier');
  if (tier !== undefined && tier !== null && typeof tier !== 'string')
    throw new TypeError('Invalid Anthropic service tier');
  return tier;
}
