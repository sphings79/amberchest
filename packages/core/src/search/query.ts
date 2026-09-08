/**
 * Turns what a human typed into an FTS5 MATCH expression.
 *
 * FTS5 has its own syntax where `-`, `*`, `:` and `"` are operators, so a
 * search for `re: 50% -rabatt` would be a syntax error. Everything is quoted
 * instead, which makes any input safe, and a trailing `*` is added so typing
 * "rechn" already finds "Rechnung".
 */
export function toMatchExpression(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const tokens: string[] = [];
  // Quoted parts stay together as a phrase, the rest is split on whitespace.
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(trimmed)) !== null) {
    const phrase = match[1];
    const word = match[2];

    if (phrase !== undefined) {
      const cleaned = phrase.trim();
      if (cleaned) tokens.push(`"${cleaned.replace(/"/g, '""')}"`);
      continue;
    }
    if (word === undefined) continue;

    // A trailing * from the user is kept as a prefix search.
    const explicitPrefix = word.endsWith('*');
    const bare = (explicitPrefix ? word.slice(0, -1) : word).replace(/"/g, '');
    if (bare === '') continue;
    tokens.push(`"${bare}"*`);
  }

  if (tokens.length === 0) return null;
  return tokens.join(' AND ');
}
