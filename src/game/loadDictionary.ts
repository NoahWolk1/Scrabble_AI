import { Trie } from './Trie';

let dictionary: Trie | null = null;

export async function loadDictionary(): Promise<Trie> {
  if (dictionary) return dictionary;
  const response = await fetch('/enable.txt');
  const text = await response.text();
  const words = text.split(/\s+/).filter(w => /^[A-Za-z]{2,}$/.test(w));
  dictionary = Trie.fromWords(words);
  return dictionary;
}
