import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface RawTile {
  letter: string;
  row: number;
  col: number;
}

interface InferredTile {
  letter: string;
  row: number;
  col: number;
  isBlank?: boolean;
}

const SYSTEM_PROMPT = `You are a Scrabble move inferrer. The player placed tiles on the board and we captured it with OCR.
OCR can have errors: wrong letters, extra letters, missing letters, or misidentified positions.

RULES:
- In Scrabble, a player plays exactly ONE word per turn (one connected sequence of tiles, horizontal OR vertical).
- The word must be valid English (in a Scrabble dictionary).
- The tiles played must come from the player's rack (letters and up to 2 blanks).
- Blanks can represent any letter.

Given:
1. The board state BEFORE the move (existing tiles)
2. The player's rack (letters they had, "?" = blank)
3. The "new" tiles that OCR detected (cells that were empty and now have something — may include OCR errors)

Output the tiles of the SINGLE word the player most likely played. Pick the most plausible legal move.
- If OCR added spurious letters, omit them.
- If OCR misread a letter, correct it to form a valid word that fits the rack.
- If multiple words are possible, choose the one that best fits the rack and board.

Return ONLY this JSON format, nothing else:
{"tiles":[{"letter":"A","row":7,"col":7,"isBlank":false}]}
Use isBlank: true only for tiles that used a blank. Letter should be the letter the blank represents.`;

/** Try to parse infer-move JSON, repairing truncation and common issues */
function tryParseInferJson(str: string): { tiles?: InferredTile[] } | null {
  const cleaned = str
    .replace(/^```json\s*|\s*```$/g, '')
    .replace(/^[^{]*/, '')
    .replace(/[^}]*$/, '')
    .trim();
  const parseAttempt = (s: string) => {
    try {
      const p = JSON.parse(s);
      return p && typeof p === 'object' ? p : null;
    } catch {
      return null;
    }
  };

  let parsed = parseAttempt(cleaned);
  if (parsed) return parsed;

  // Repair: close unclosed strings, add missing brackets
  let repaired = cleaned;
  const quoteCount = (repaired.match(/"/g) || []).length;
  if (quoteCount % 2 === 1) repaired += '"';
  const openBrace = (repaired.match(/\{/g) || []).length;
  const closeBrace = (repaired.match(/\}/g) || []).length;
  repaired += '}'.repeat(Math.max(0, openBrace - closeBrace));
  parsed = parseAttempt(repaired);
  if (parsed) return parsed;

  // Extract tiles array via regex - flexible for different key orders
  const tilesMatch = repaired.match(/"tiles"\s*:\s*\[([\s\S]*)\]/);
  if (tilesMatch) {
    const inner = tilesMatch[1];
    const objMatches = inner.match(/\{[^{}]*\}/g) || [];
    const tiles: InferredTile[] = [];
    for (const objStr of objMatches) {
      const letterMatch = objStr.match(/"letter"\s*:\s*"([A-Za-z?])"/);
      const rowMatch = objStr.match(/"row"\s*:\s*(\d+)/);
      const colMatch = objStr.match(/"col"\s*:\s*(\d+)/);
      if (letterMatch && rowMatch && colMatch) {
        const letter = letterMatch[1].toUpperCase();
        if (/^[A-Z?]$/.test(letter)) {
          tiles.push({
            letter: letter === '?' ? ' ' : letter,
            row: Math.max(0, Math.min(14, parseInt(rowMatch[1], 10) || 0)),
            col: Math.max(0, Math.min(14, parseInt(colMatch[1], 10) || 0)),
            isBlank: /\b"isBlank"\s*:\s*true\b/.test(objStr),
          });
        }
      }
    }
    if (tiles.length > 0) return { tiles };
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'GEMINI_API_KEY not configured.',
    });
  }

  try {
    const body = req.body as {
      board?: (string | null)[][];
      rack?: string[];
      newTiles?: RawTile[];
    };

    const board = body?.board;
    const rack = body?.rack ?? [];
    const newTiles = body?.newTiles ?? [];

    if (!Array.isArray(board) || board.length !== 15) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid board: expected 15x15 array',
      });
    }

    const rackStr = rack.map((c) => (c === ' ' ? '?' : c)).join(',');
    const boardStr = JSON.stringify(
      board.map((row) =>
        (row ?? []).slice(0, 15).map((c) => (c === null || c === '' ? '' : c === ' ' ? '?' : c))
      )
    );
    const newTilesStr = JSON.stringify(newTiles);

    const prompt = `${SYSTEM_PROMPT}

Board (before move), 15 rows:
${boardStr}

Player's rack: [${rackStr}]

New tiles detected by OCR (may have errors): ${newTilesStr}

Return ONLY valid JSON with a "tiles" array.`;

    const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
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

    const parsed = tryParseInferJson(text);
    if (!parsed) {
      console.warn('Gemini infer-move: could not parse response:', text.slice(0, 200));
      return res.status(502).json({
        status: 'ERROR',
        message: 'Could not parse Gemini response as JSON',
      });
    }

    const tiles = Array.isArray(parsed?.tiles) ? parsed.tiles : [];
    const normalized: InferredTile[] = tiles
      .filter((t) => t && typeof t.row === 'number' && typeof t.col === 'number' && t.letter)
      .map((t) => ({
        letter: String(t.letter).toUpperCase().slice(0, 1),
        row: Math.max(0, Math.min(14, Math.floor(Number(t.row)))),
        col: Math.max(0, Math.min(14, Math.floor(Number(t.col)))),
        isBlank: !!t.isBlank,
      }));

    if (normalized.length === 0) {
      return res.status(200).json({
        status: 'ERROR',
        message: 'Could not infer a valid move',
      });
    }

    return res.status(200).json({ status: 'OK', tiles: normalized });
  } catch (err) {
    console.error('Infer move error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Infer move failed',
    });
  }
}
