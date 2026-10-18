import type {
  OpenRouterModelMetadata,
  OpenRouterModelPricing,
} from './model-discovery-metadata.ts';
import type { PriceSort } from './model-list-query.ts';

interface DecimalDigit {
  readonly power: bigint;
  readonly value: number;
}

function addPriceDigits(digits: Map<bigint, number>, price: string): void {
  const exponentIndex = price.search(/[eE]/u);
  const mantissa = exponentIndex < 0 ? price : price.slice(0, exponentIndex);
  const exponent = exponentIndex < 0 ? 0n : BigInt(price.slice(exponentIndex + 1));
  const point = mantissa.indexOf('.');
  const fractionLength = point < 0 ? 0 : mantissa.length - point - 1;
  const coefficient = mantissa.replace('.', '');
  let power = exponent - BigInt(fractionLength);
  for (let index = coefficient.length - 1; index >= 0; index--, power++) {
    const value = coefficient.charCodeAt(index) - 48;
    if (value !== 0) digits.set(power, (digits.get(power) ?? 0) + value);
  }
}

function summedPriceDigits(pricing: OpenRouterModelPricing): readonly DecimalDigit[] {
  const digits = new Map<bigint, number>();
  addPriceDigits(digits, pricing.prompt);
  addPriceDigits(digits, pricing.completion);
  const powers = [...digits.keys()].sort((left, right) => (left < right ? -1 : 1));
  for (const power of powers) {
    const value = digits.get(power) ?? 0;
    if (value >= 10) {
      digits.set(power, value - 10);
      digits.set(power + 1n, (digits.get(power + 1n) ?? 0) + 1);
    }
  }
  return [...digits]
    .filter(([, value]) => value !== 0)
    .sort(([left], [right]) => (left > right ? -1 : 1))
    .map(([power, value]) => ({ power, value }));
}

function compareDigits(left: readonly DecimalDigit[], right: readonly DecimalDigit[]): number {
  for (let index = 0; index < left.length || index < right.length; index++) {
    const leftDigit = left[index];
    const rightDigit = right[index];
    if (leftDigit === undefined) return -1;
    if (rightDigit === undefined) return 1;
    if (leftDigit.power !== rightDigit.power) return leftDigit.power < rightDigit.power ? -1 : 1;
    if (leftDigit.value !== rightDigit.value) return leftDigit.value - rightDigit.value;
  }
  return 0;
}

export function createModelPriceComparator(sort: PriceSort) {
  const cache = new WeakMap<OpenRouterModelMetadata, readonly DecimalDigit[]>();
  function key(metadata: OpenRouterModelMetadata): readonly DecimalDigit[] {
    let digits = cache.get(metadata);
    if (digits === undefined) {
      digits = summedPriceDigits(metadata.pricing);
      cache.set(metadata, digits);
    }
    return digits;
  }
  return (
    left: OpenRouterModelMetadata | undefined,
    right: OpenRouterModelMetadata | undefined,
  ): number => {
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    const order = compareDigits(key(left), key(right));
    return sort === 'pricing-low-to-high' ? order : -order;
  };
}
