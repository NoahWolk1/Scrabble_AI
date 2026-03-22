/**
 * Dev server for Gemini fix-board API.
 * Loads .env.local for GEMINI_API_KEY. Vite proxies /api/gemini to this server.
 */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const PORT = 3001;
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const TILE_DISTRIBUTION = {
  ' ': 2, A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9,
  J: 1, K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4,
  T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
};

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
2. STANDALONE LETTERS (critical): In Scrabble, every letter must touch another letter (adjacent up/down/left/right). A letter with NO neighbors is invalid — remove it.
3. Spurious letters: Random letters that don't form valid English words — remove them.
4. OCR mistakes: Wrong letters that break words — fix them.
5. All letters must form valid Scrabble words.

Output ONLY a JSON array of 15 rows. Each row = 15 cells. Use "" for empty, single letter for tile, "?" for blank. Keep compact. Return ONLY valid JSON.`;

function removeIsolatedLetters(grid) {
  let result = grid.map((row) => [...row]);
  const hasLetter = (g, r, c) => (g[r]?.[c] && g[r][c] !== ' ');
  const hasNeighbor = (g, r, c) =>
    hasLetter(g, r - 1, c) || hasLetter(g, r + 1, c) || hasLetter(g, r, c - 1) || hasLetter(g, r, c + 1);
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

function removeDisconnectedClusters(grid) {
  const visited = new Set();
  const components = [];
  const key = (r, c) => `${r},${c}`;
  const hasLetter = (r, c) => grid[r]?.[c] && grid[r][c] !== ' ';

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (!hasLetter(r, c) || visited.has(key(r, c))) continue;
      const component = new Set();
      const stack = [[r, c]];
      while (stack.length > 0) {
        const [rr, cc] = stack.pop();
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

function enforceTileLimits(grid) {
  const count = {};
  const positions = {};
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
    let toRemove = (count[letter] ?? 0) - maxAllowed;
    if (toRemove <= 0) continue;
    const cells = positions[letter] ?? [];
    for (let i = cells.length - 1; i >= 0 && toRemove > 0; i--, toRemove--) {
      const [r, c] = cells[i];
      result[r][c] = null;
    }
  }
  return result;
}

function tryParseGridJson(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    if (!e.message?.includes('JSON')) return null;
  }
  let repaired = str;
  const inString = (repaired.match(/"/g) || []).length % 2 === 1;
  if (inString) repaired += '"';
  let open = 0;
  for (const c of repaired) {
    if (c === '[') open++;
    else if (c === ']') open = Math.max(0, open - 1);
  }
  repaired += ']'.repeat(open);
  try {
    return JSON.parse(repaired);
  } catch {
    const rows = [];
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

async function fixBoard(grid, apiKey) {
  const gridStr = JSON.stringify(
    grid.map((row) =>
      (row ?? []).slice(0, 15).map((c) => (c === null || c === '' ? '' : c === ' ' ? '?' : c))
    )
  );

  const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nBoard from recognition (fix any errors):\n${gridStr}` }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API: ${response.status}`);

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
  let parsed = tryParseGridJson(cleaned);
  if (!parsed || !Array.isArray(parsed) || parsed.length !== 15) throw new Error('Could not parse grid from Gemini');

  let fixed = parsed.map((row) =>
    (row ?? []).slice(0, 15).map((c) => {
      if (c === null || c === undefined || c === '') return null;
      if (c === '?' || c === ' ') return ' ';
      const s = String(c).trim();
      return s.length === 1 && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
    })
  );

  fixed = removeIsolatedLetters(fixed);
  fixed = removeDisconnectedClusters(fixed);
  fixed = enforceTileLimits(fixed);
  return fixed;
}

function applyPostProcessingOnly(grid) {
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

function buildRecognizePrompt(priorGrid) {
  const base = `You are reading a Scrabble board from a photo. Extract the 15×15 grid of letters.
Rules: Row 0=top, Col 0=left. Empty="", letter=uppercase A-Z, blank="?".
Common confusions: O/0, I/1/l, S/5, E/F, R/K.`;
  if (priorGrid && Array.isArray(priorGrid) && priorGrid.length === 15) {
    const priorStr = JSON.stringify(
      priorGrid.map((row) =>
        (row ?? []).slice(0, 15).map((c) => (c === null || c === '' ? '' : c === ' ' ? '?' : c))
      )
    );
    return `${base}

IMPORTANT - USE THE PRIOR BOARD: The image shows the board after a move. The previous valid board state is provided below.
- Only 2–7 cells typically change per turn (one new word).
- Use the prior state as the DEFAULT for every cell.
- Only UPDATE cells where you clearly see NEW letters placed.
- Do NOT re-read the entire board—focus on what changed.
- If a cell is unclear or could be glare/noise, keep the prior value.

Previous board state (use as default):
${priorStr}

Output ONLY a JSON array of exactly 15 rows. Each row is an array of exactly 15 cells. No markdown.`;
  }
  return `${base}
Output ONLY a JSON array of 15 rows, each 15 cells. No markdown.`;
}

function normalizeRecognizedGrid(parsed) {
  return (parsed ?? []).slice(0, 15).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, 15).map((c) => {
      if (c === null || c === undefined || c === '') return null;
      if (c === '?' || c === ' ') return ' ';
      const s = String(c).trim();
      return s.length === 1 && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
    })
  );
}

async function recognizeBoard(imageBase64, mimeType, apiKey, priorBoard) {
  const prompt = buildRecognizePrompt(priorBoard);
  const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API: ${response.status}`);

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');

  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
  let parsed = tryParseGridJson(cleaned);
  if (!parsed || !Array.isArray(parsed) || parsed.length !== 15) throw new Error('Could not parse grid');

  return normalizeRecognizedGrid(parsed);
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url || '').split('?')[0];
  if (req.method !== 'POST' || (path !== '/fix-board' && path !== '/recognize-board')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: 'Not found' }));
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: 'GEMINI_API_KEY not set. Create .env.local with GEMINI_API_KEY=your_key' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  if (path === '/recognize-board') {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: 'Invalid JSON' }));
      return;
    }
    const image = parsed?.image;
    const mimeType = parsed?.mimeType || 'image/jpeg';
    const priorBoard = Array.isArray(parsed?.priorBoard) && parsed.priorBoard.length === 15 ? parsed.priorBoard : null;
    if (!image || typeof image !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: 'Missing image (base64)' }));
      return;
    }
    try {
      const grid = await recognizeBoard(image, mimeType, apiKey, priorBoard);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', grid }));
    } catch (err) {
      console.warn('Gemini Vision recognize failed:', err?.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: (err?.message || 'Recognition failed').replace(/[^\x20-\x7E]/g, '') }));
    }
    return;
  }

  let grid;
  try {
    const parsed = JSON.parse(body);
    grid = parsed?.grid;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: 'Invalid JSON' }));
    return;
  }

  if (!Array.isArray(grid) || grid.length !== 15) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: 'Invalid grid: expected 15x15 array' }));
    return;
  }

  try {
    const fixed = await fixBoard(grid, apiKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', grid: fixed }));
  } catch (err) {
    console.warn('Gemini fix failed, falling back to post-processing only:', err.message);
    try {
      const fixed = applyPostProcessingOnly(grid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', grid: fixed }));
    } catch (fallbackErr) {
      console.error('Fallback failed:', fallbackErr);
      const msg = (err?.message || 'Fix failed').replace(/[^\x20-\x7E]/g, '');
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: msg }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`Gemini fix API dev server: http://localhost:${PORT}`);
});
