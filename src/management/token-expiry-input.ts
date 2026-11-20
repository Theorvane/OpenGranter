export { parseUtcMilliseconds as parseTokenExpiry } from './utc-milliseconds-input.ts';

export function tokenExpiryDescription(milliseconds: number): string {
  const date = new Date(milliseconds);
  const utc = Number.isFinite(date.getTime()) ? `UTC: ${date.toISOString()}; ` : '';
  return `${utc}expiry (Unix milliseconds): ${milliseconds}`;
}
