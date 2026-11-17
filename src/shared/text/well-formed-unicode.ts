/** URLSearchParams silently replaces lone surrogates; exact filters must not. */
export function isWellFormedUnicode(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}
