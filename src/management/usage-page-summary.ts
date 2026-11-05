import type { UsageRecord } from '../usage/record-usage.ts';
import type { UsageElement } from './usage-app.ts';

type Amount = { units: bigint; scale: number };

// Inputs are validated ledger decimal strings. Never round money through Number.
function totals(records: readonly UsageRecord[], key: 'estimatedCost' | 'upstreamBilledCost') {
  const currencies = new Map<string, Amount>();
  for (const record of records) {
    const cost = record[key];
    if (!cost) continue;
    const [whole, fraction = ''] = cost.amountDecimal.split('.');
    const units = BigInt(whole + fraction);
    const previous = currencies.get(cost.currency) ?? { units: 0n, scale: 0 };
    const scale = Math.max(previous.scale, fraction.length);
    currencies.set(cost.currency, {
      units:
        previous.units * 10n ** BigInt(scale - previous.scale) +
        units * 10n ** BigInt(scale - fraction.length),
      scale,
    });
  }
  return (
    [...currencies.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([currency, { units, scale }]) => {
        const digits = units.toString().padStart(scale + 1, '0');
        const decimal =
          scale === 0
            ? digits
            : (digits.slice(0, -scale) + '.' + digits.slice(-scale))
                .replace(/0+$/u, '')
                .replace(/\.$/u, '');
        return decimal + ' ' + currency;
      })
      .join('; ') || 'Unknown'
  );
}

/** Summary of already authorized, validated current-page rows only.
 * Duplicates stay included; no currency conversion or reconciliation is inferred.
 * The owning ready render controls the lifetime of these nodes and their rows.
 */
export function renderUsagePageSummary(
  document: UsageElement['ownerDocument'],
  records: readonly UsageRecord[],
): UsageElement {
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Current page cost summary');
  const heading = document.createElement('h2');
  heading.textContent = 'Current page only — not an invoice or all-pages total';
  section.append(heading);
  const estimated = records.filter((row) => row.estimatedCost !== null).length;
  const reported = records.filter((row) => row.upstreamBilledCost !== null).length;
  for (const line of [
    'Records: ' + records.length,
    'Estimated cost coverage: ' + estimated + ' of ' + records.length + ' records',
    'Estimated totals: ' + totals(records, 'estimatedCost'),
    'Reported cost coverage: ' + reported + ' of ' + records.length + ' records',
    'Reported totals: ' + totals(records, 'upstreamBilledCost'),
    ...(['reported', 'partial', 'missing', 'invalid'] as const).map(
      (state) =>
        state.charAt(0).toUpperCase() +
        state.slice(1) +
        ' usage: ' +
        records.filter((row) => row.usage.status === state).length,
    ),
    'Possibly billed: ' + records.filter((row) => row.possiblyBilled).length,
    'Possible duplicates: ' +
      records.filter((row) => row.possibleDuplicate).length +
      ' (included, not deduplicated)',
  ]) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    section.append(paragraph);
  }
  return section;
}
