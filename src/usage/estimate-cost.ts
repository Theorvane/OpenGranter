import type { EstimatedCost, TokenUsage } from './record-usage.ts';

/** Caller-selected applicable version, never discovery metadata or provider content. */
export interface FlatTokenPriceSnapshot {
  readonly kind: 'flat-token';
  readonly priceVersion: string;
  readonly currency: string;
  readonly inputPerToken: string;
  readonly outputPerToken: string;
}

export class InvalidUsagePrice extends Error {
  constructor() {
    super('Invalid usage price');
    this.name = 'InvalidUsagePrice';
  }
}

function decimal(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)
  );
}

/** Exact flat aggregate estimate only; never rounding, invoice or budget authority. */
export function estimateUsageCost(
  usage: TokenUsage,
  price: FlatTokenPriceSnapshot | null | undefined,
): EstimatedCost | null {
  if (price == null) return null;
  let input: string;
  let output: string;
  let version: string;
  let currency: string;
  try {
    const { kind, priceVersion, currency: unit, inputPerToken, outputPerToken } = price;
    if (
      kind !== 'flat-token' ||
      typeof priceVersion !== 'string' ||
      priceVersion.trim().length === 0 ||
      priceVersion.length > 256 ||
      /[\p{Cc}\p{Cs}]/u.test(priceVersion) ||
      typeof unit !== 'string' ||
      !/^[A-Z]{3}$/u.test(unit) ||
      !decimal(inputPerToken) ||
      !decimal(outputPerToken)
    ) {
      throw new InvalidUsagePrice();
    }
    input = inputPerToken;
    output = outputPerToken;
    version = priceVersion;
    currency = unit;
  } catch {
    throw new InvalidUsagePrice();
  }
  const { status, promptTokens, completionTokens, totalTokens } = usage;
  const count = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (
    status !== 'reported' ||
    !count(promptTokens) ||
    !count(completionTokens) ||
    !count(totalTokens)
  )
    return null;
  const scale = Math.max(input.split('.')[1]?.length ?? 0, output.split('.')[1]?.length ?? 0);
  function coefficient(rate: string): bigint {
    const [whole, fraction = ''] = rate.split('.');
    return BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
  }
  const amount =
    coefficient(input) * BigInt(promptTokens) + coefficient(output) * BigInt(completionTokens);
  const digits = amount.toString().padStart(scale + 1, '0');
  const amountDecimal =
    scale === 0
      ? digits
      : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
          .replace(/0+$/u, '')
          .replace(/\.$/u, '');
  if (amountDecimal.length > 128) return null;
  return Object.freeze({ amountDecimal, currency, priceVersion: version });
}
