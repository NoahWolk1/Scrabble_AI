// Trie data structure for fast word lookup and prefix checking
interface TrieNode {
  children: Map<string, TrieNode>;
  isWord: boolean;
}

export class Trie {
  private root: TrieNode;

  constructor() {
    this.root = { children: new Map(), isWord: false };
  }

  insert(word: string): void {
    if (!word || word.length === 0) return;
    const upper = word.toUpperCase();
    let node = this.root;
    for (const char of upper) {
      if (!node.children.has(char)) {
        node.children.set(char, { children: new Map(), isWord: false });
      }
      node = node.children.get(char)!;
    }
    node.isWord = true;
  }

  has(word: string): boolean {
    const upper = word.toUpperCase();
    let node = this.root;
    for (const char of upper) {
      if (!node.children.has(char)) return false;
      node = node.children.get(char)!;
    }
    return node.isWord;
  }

  hasPrefix(prefix: string): boolean {
    const upper = prefix.toUpperCase();
    let node = this.root;
    for (const char of upper) {
      if (!node.children.has(char)) return false;
      node = node.children.get(char)!;
    }
    return true;
  }

  // Get all words that can be formed with the given letters (for move generation)
  getWordsWithLetters(letters: string[], minLength = 1): string[] {
    const results: string[] = [];
    const count: Record<string, number> = {};
    for (const l of letters) {
      const c = l === ' ' ? ' ' : l.toUpperCase();
      count[c] = (count[c] ?? 0) + 1;
    }

    const search = (node: TrieNode, path: string, remaining: Record<string, number>) => {
      if (path.length >= minLength && node.isWord) {
        results.push(path);
      }
      for (const [char, child] of node.children) {
        const rem = remaining[char] ?? 0;
        const blankRem = remaining[' '] ?? 0;
        if (rem > 0) {
          const newRem = { ...remaining };
          newRem[char] = rem - 1;
          search(child, path + char, newRem);
        }
        if (char !== ' ' && blankRem > 0) {
          const newRem = { ...remaining };
          newRem[' '] = blankRem - 1;
          search(child, path + char, newRem);
        }
      }
    };
    search(this.root, '', count);
    return results;
  }

  static fromWords(words: string[]): Trie {
    const trie = new Trie();
    for (const w of words) {
      if (/^[A-Za-z]+$/.test(w)) {
        trie.insert(w);
      }
    }
    return trie;
  }
}
