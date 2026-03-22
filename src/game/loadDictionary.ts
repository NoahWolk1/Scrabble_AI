import { Trie } from './Trie';

// Bundled at build time — avoids fetch/404 issues when deployed as SPA
import dictText from '../data/twl06.txt?raw';

let dictionary: Trie | null = null;

/**
 * Loads the TWL06 (Official Tournament and Club Word List) dictionary.
 * Source: https://www.freescrabbledictionary.com/twl06/
 * 178,691 words, 2–15 letters — the standard for North American Scrabble.
 */
export async function loadDictionary(): Promise<Trie> {
  if (dictionary) return dictionary;
  const words = dictText
    .split(/\n/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{2,15}$/.test(w));
  dictionary = Trie.fromWords(words);
  return dictionary;
}
