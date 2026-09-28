export type CsvValue = string | number | boolean | null | undefined;

function cell(value: string | number | boolean | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Encoding only: callers authorize and project metadata before invoking this helper. */
export function encodeCsv(
  columns: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  return `${[columns.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n')}\r\n`;
}
