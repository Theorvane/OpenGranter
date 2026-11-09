/** Shared addressability grammar for SSO Models results and detail paths. */
export function validSsoCatalogAlias(alias: string): boolean {
  return (
    alias.length > 0 &&
    alias.length <= 512 &&
    !/[\s%\\?#]/u.test(alias) &&
    !Array.from(alias).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      );
    }) &&
    alias.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
