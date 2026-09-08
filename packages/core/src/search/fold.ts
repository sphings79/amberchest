/**
 * German spelling variants for the full text index.
 *
 * SQLite's unicode61 tokeniser strips diacritics, so "München" is already found
 * by "munchen". What it cannot do is the German transliteration people actually
 * type: "muenchen", "strasse", "gruesse". Those variants are appended to the
 * indexed text, which makes both spellings find the same message.
 */

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/Ä/g, 'Ae'],
  [/Ö/g, 'Oe'],
  [/Ü/g, 'Ue'],
  [/ß/g, 'ss'],
];

const NEEDS_FOLDING = /[äöüÄÖÜß]/;

/** Transliterates umlauts and sharp s the way German keyboards work around them. */
export function foldGerman(value: string): string {
  let result = value;
  for (const [pattern, replacement] of REPLACEMENTS) result = result.replace(pattern, replacement);
  return result;
}

/**
 * Collects the transliterated form of every word that has an umlaut in it.
 *
 * Only the affected words are returned, so the index grows by a few percent
 * instead of doubling.
 */
export function foldedVariants(text: string): string {
  if (!NEEDS_FOLDING.test(text)) return '';

  const seen = new Set<string>();
  for (const word of text.split(/\s+/)) {
    if (!NEEDS_FOLDING.test(word)) continue;
    const folded = foldGerman(word);
    if (folded !== word) seen.add(folded);
  }

  return [...seen].join(' ');
}

/** Text plus its folded variants, ready to be written into the index. */
export function withFoldedVariants(text: string): string {
  const variants = foldedVariants(text);
  return variants ? `${text} ${variants}` : text;
}
