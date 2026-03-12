import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Scrabble tile distribution - max count per letter in the entire game
const TILE_DISTRIBUTION: Record<string, number> = {
  ' ': 2, A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9,
  J: 1, K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4,
  T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
};

/** Remove letters that have no adjacent letters (standalone - invalid in Scrabble) */
function removeIsolatedLetters(grid: (string | null)[][]): (string | null)[][] {
  let result = grid.map((row) => [...row]);

  const hasLetter = (g: (string | null)[][], r: number, c: number) => {
    const cell = g[r]?.[c];
    return !!cell && cell !== ' ';
  };

  const hasNeighbor = (g: (string | null)[][], r: number, c: number) =>
    hasLetter(g, r - 1, c) || hasLetter(g, r + 1, c) || hasLetter(g, r, c - 1) || hasLetter(g, r, c + 1);

  // Iterate until no more isolated letters (removing one can isolate others)
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (!hasLetter(result, r, c)) continue;
        if (!hasNeighbor(result, r, c)) {
          result[r][c] = null;
          changed = true;
        }
      }
    }
  }

  return result;
}

/** Keep only the largest connected component of letters (valid Scrabble boards are one connected cluster) */
function removeDisconnectedClusters(grid: (string | null)[][]): (string | null)[][] {
  const visited = new Set<string>();
  const components: Set<string>[] = [];

  const key = (r: number, c: number) => `${r},${c}`;
  const hasLetter = (r: number, c: number) => {
    const cell = grid[r]?.[c];
    return !!cell && cell !== ' ';
  };

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (!hasLetter(r, c) || visited.has(key(r, c))) continue;

      const component = new Set<string>();
      const stack: [number, number][] = [[r, c]];

      while (stack.length > 0) {
        const [rr, cc] = stack.pop()!;
        const k = key(rr, cc);
        if (visited.has(k)) continue;
        visited.add(k);
        component.add(k);

        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = rr + dr, nc = cc + dc;
          if (hasLetter(nr, nc) && !visited.has(key(nr, nc))) stack.push([nr, nc]);
        }
      }
      components.push(component);
    }
  }

  if (components.length <= 1) return grid;

  const largest = components.reduce((a, b) => (a.size >= b.size ? a : b));
  const result = grid.map((row) => [...row]);

  for (const comp of components) {
    if (comp === largest) continue;
    for (const k of comp) {
      const [r, c] = k.split(',').map(Number);
      result[r][c] = null;
    }
  }
  return result;
}

/** Try to parse grid JSON, repairing truncation (unterminated string, missing brackets) */
function tryParseGridJson(str: string): (string | null)[][] | null {
  const cleaned = str.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const p = JSON.parse(cleaned);
    return Array.isArray(p) ? p : null;
  } catch {
    // Repair truncated JSON: close unclosed string, add missing ]
    let repaired = cleaned;
    const quoteCount = (repaired.match(/"/g) || []).length;
    if (quoteCount % 2 === 1) repaired += '"';
    let open = 0;
    for (const c of repaired) {
      if (c === '[') open++;
      else if (c === ']') open = Math.max(0, open - 1);
    }
    repaired += ']'.repeat(open);
    try {
      const p = JSON.parse(repaired);
      return Array.isArray(p) ? p : null;
    } catch {
      // Extract rows via regex for severely truncated output
      const rows: (string | null)[][] = [];
      let rest = repaired.replace(/^\s*\[\s*/, '');
      for (let i = 0; i < 15 && rest.length; i++) {
        const m = rest.match(/^\s*\[([^\]]*)\]?\s*,?/);
        const raw = m ? m[1] : '';
        const cells = raw.split(',').map((c) => {
          const s = c.replace(/^["']|["']$/g, '').trim();
          if (!s || s === 'null') return null;
          if (s === '?' || s === ' ') return ' ';
          return s.length === 1 && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
        });
        const padded = cells.slice(0, 15);
        while (padded.length < 15) padded.push(null);
        rows.push(padded);
        rest = m ? rest.slice(m[0].length).replace(/^\s*,?\s*/, '') : '';
      }
      while (rows.length < 15) rows.push(Array(15).fill(null));
      return rows;
    }
  }
}

/** Apply only post-processing (no Gemini) - used when Gemini returns bad JSON */
function applyPostProcessingOnly(grid: (string | null)[][]): (string | null)[][] {
  const normalized = grid.map((row) =>
    (row ?? []).slice(0, 15).map((c) => {
      if (c === null || c === undefined || c === '') return null;
      if (c === ' ' || c === '?') return ' ';
      const s = String(c).trim();
      return s.length === 1 && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
    })
  );
  let fixed = removeIsolatedLetters(normalized);
  fixed = removeDisconnectedClusters(fixed);
  fixed = enforceTileLimits(fixed);
  return fixed;
}

/** Enforce Scrabble tile limits by clearing excess letters */
function enforceTileLimits(grid: (string | null)[][]): (string | null)[][] {
  const count: Record<string, number> = {};
  const positions: Record<string, [number, number][]> = {};

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = grid[r]?.[c];
      if (!cell || cell === ' ') continue;
      const letter = cell.toUpperCase();
      count[letter] = (count[letter] ?? 0) + 1;
      if (!positions[letter]) positions[letter] = [];
      positions[letter].push([r, c]);
    }
  }

  const result = grid.map((row) => [...row]);

  for (const [letter, maxAllowed] of Object.entries(TILE_DISTRIBUTION)) {
    if (letter === ' ') continue;
    const current = count[letter] ?? 0;
    if (current <= maxAllowed) continue;

    let toRemove = current - maxAllowed;
    const cells = positions[letter] ?? [];
    // Remove excess, preferring later positions (often noise at edges)
    for (let i = cells.length - 1; i >= 0 && toRemove > 0; i--, toRemove--) {
      const [r, c] = cells[i];
      result[r][c] = null;
    }
  }

  return result;
}

const TILE_LIMITS = `Scrabble tile limits (entire game - 100 tiles total). NEVER exceed these counts on the board:
- Only 1 each: J, K, Q, X, Z
- Only 2 each: B, C, F, H, M, P, V, W, Y
- Max 4 each: D, L, S, U
- Max 6 each: N, R, T
- Max 8: O
- Max 9: A, I
- Max 12: E
- 2 blanks (?)
If you see 2+ Zs, 2+ Qs, 2+ Js, etc. — those are OCR errors. Remove the extras.`;

const SYSTEM_PROMPT = `You are a Scrabble board corrector. You receive a 15x15 board from OCR, which often has errors:

1. IMPOSSIBLE LETTER COUNTS (most critical): ${TILE_LIMITS}
   Multiple Zs, Qs, Js, Ks, or Xs on the board are ALWAYS wrong. Remove them.

2. STANDALONE LETTERS (critical): In Scrabble, every letter must touch another letter (adjacent up/down/left/right). A letter with NO neighbors is invalid — remove it. No floating/orphan letters.

3. Spurious letters: Random letters that don't form valid English words (horizontal or vertical) — remove them.

4. OCR mistakes: Wrong letters that break words (e.g., HELLD→HELLO, CAT→CAR) — fix them.

5. All letters must form valid Scrabble words. Remove any letter that can't be part of a real word.

Output ONLY a JSON array of 15 rows. Each row = 15 cells. Use short values: "" for empty, single letter for tile, "?" for blank.
Keep it compact. Return ONLY valid JSON.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'GEMINI_API_KEY not configured. Add it in Vercel project settings or .env.local for local dev.',
    });
  }

  try {
    const grid = req.body?.grid as (string | null)[][] | undefined;
    if (!Array.isArray(grid) || grid.length !== 15) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid grid: expected 15x15 array',
      });
    }

    const gridStr = JSON.stringify(
      grid.map((row) =>
        (row ?? []).slice(0, 15).map((c) => (c === null || c === '' ? '' : c === ' ' ? '?' : c))
      )
    );

    const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${SYSTEM_PROMPT}\n\nBoard from recognition (fix any errors):\n${gridStr}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Gemini API error:', response.status, err);
      return res.status(502).json({
        status: 'ERROR',
        message: `Gemini API error: ${response.status}`,
      });
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(502).json({
        status: 'ERROR',
        message: 'Empty response from Gemini',
      });
    }

    const parsed = tryParseGridJson(text);
    if (!parsed || parsed.length !== 15) {
      const fixed = applyPostProcessingOnly(grid);
      return res.status(200).json({ status: 'OK', grid: fixed });
    }

    let fixed: (string | null)[][] = parsed.map((row: unknown) => {
      const r = Array.isArray(row) ? row : [];
      return r.slice(0, 15).map((c: unknown) => {
        if (c === null || c === undefined || c === '') return null;
        if (c === '?' || c === ' ') return ' ';
        const s = String(c).trim();
        if (s.length === 1 && /[A-Za-z]/.test(s)) return s.toUpperCase();
        return null;
      });
    });

    // Remove standalone letters (no adjacent letters) and disconnected clusters
    fixed = removeIsolatedLetters(fixed);
    fixed = removeDisconnectedClusters(fixed);
    fixed = enforceTileLimits(fixed);

    return res.status(200).json({ status: 'OK', grid: fixed });
  } catch (err) {
    console.warn('Gemini fix failed, falling back to post-processing:', err);
    try {
      const fixed = applyPostProcessingOnly(grid);
      return res.status(200).json({ status: 'OK', grid: fixed });
    } catch (fallbackErr) {
      console.error('Fallback failed:', fallbackErr);
      return res.status(500).json({
        status: 'ERROR',
        message: err instanceof Error ? err.message : 'Fix failed',
      });
    }
  }
}
