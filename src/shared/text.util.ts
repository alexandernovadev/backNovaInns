// "  PEDRO   GomEZ AlvareZ " → "Pedro Gomez Alvarez" (también "maría-josé" → "María-José")
export function toTitleCase(value: unknown): string {
  if (typeof value !== 'string') return value as string;
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toLocaleUpperCase('es'));
}
