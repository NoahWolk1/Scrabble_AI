import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You infer the Scrabble move a player most likely made.

Given:
1. previousBoard: 15x15 grid BEFORE the player's move (empty cells = "" or null)
2. recognizedBoard: 15x15 grid from a PHOTO after the player placed tiles (OCR may have errors)
3. humanRack: the letters the player had (use "?" for blank)

In Scrabble, a legal move places tiles that form exactly ONE new word (horizontal or vertical). The word can extend existing words (e.g. adding S to CAT→CATS) or form a new word that crosses existing letters.

Assume the player played a legal, single-word move. Your job: infer which tiles they placed.

Rules:
- Return ONLY the tiles the player PLACED this turn (the new ones)
- All returned tiles must be in cells that are empty in previousBoard and have a letter in recognizedBoard
- The tiles must form one connected word (horizontal or vertical)
- Prefer using letters from humanRack; blanks (?) can represent any letter
- If OCR misread a letter, infer the correct letter that forms a valid English word
- Row and col are 0-14

Output ONLY a JSON array: [{"row":0,"col":7,"letter":"A"},...]
Use "isBlank": true when a blank tile was used. Return [] if no valid single-word move can be inferred.`;

function tryParseTilesJson(str: string): { row: number; col: number; letter: string; isBlank?: boolean }[] | null {
  const cleaned = str.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const p = JSON.parse(cleaned);
    if (!Array.isArray(p)) return null;
    return p.map((t: unknown) => {
      if (t && typeof t === 'object' && 'row' in t && 'col' in t && 'letter' in t) {
        const obj = t as { row: number; col: number; letter: string; isBlank?: boolean };
        const letter = String(obj.letter || '').trim().toUpperCase();
        if (letter.length !== 1 && !obj.isBlank) return null;
        return {
          row: Math.max(0, Math.min(14, Number(obj.row) || 0)),
          col: Math.max(0, Math.min(14, Number(obj.col) || 0)),
          letter: letter || ' ',
          isBlank: !!obj.isBlank,
        };
      }
      return null;
    }).filter(Boolean);
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'GEMINI_API_KEY not configured',
    });
  }

  try {
    const { previousBoard, recognizedBoard, humanRack } = req.body as {
      previousBoard?: (string | null)[][];
      recognizedBoard?: (string | null)[][];
      humanRack?: string[];
    };

    if (!Array.isArray(previousBoard) || previousBoard.length !== 15 ||
        !Array.isArray(recognizedBoard) || recognizedBoard.length !== 15) {
      return res.status(400).json({
        status: 'ERROR',
        message: 'Invalid input: need 15x15 previousBoard and recognizedBoard',
      });
    }

    const rackStr = Array.isArray(humanRack)
      ? humanRack.map((c) => (c === ' ' || c === '?' ? '?' : c)).join(',')
      : '';

    const prevStr = JSON.stringify(
      previousBoard.map((row) =>
        (row ?? []).slice(0, 15).map((c) => (c === null || c === '' ? '' : c === ' ' ? '?' : c))
      )
    );
    const recStr = JSON.stringify(
      recognizedBoard.map((row) =>
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
                text: `${SYSTEM_PROMPT}\n\npreviousBoard:\n${prevStr}\n\nrecognizedBoard:\n${recStr}\n\nhumanRack: [${rackStr}]`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
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

    let tiles = tryParseTilesJson(text);
    if (!tiles || tiles.length === 0) {
      return res.status(200).json({
        status: 'OK',
        tiles: [],
        message: 'Could not infer a valid move',
      });
    }

    // For blanks, ensure letter is the actual letter played (from recognized board)
    tiles = tiles.map((t) => {
      if (t.isBlank && (t.letter === '?' || t.letter === ' ')) {
        const cell = recognizedBoard[t.row]?.[t.col];
        const letter = cell && cell !== ' ' && /^[A-Z]$/.test(String(cell).toUpperCase())
          ? String(cell).toUpperCase()
          : 'E'; // fallback
        return { ...t, letter };
      }
      return t;
    });

    return res.status(200).json({ status: 'OK', tiles });
  } catch (err) {
    console.error('infer-move error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Infer move failed',
    });
  }
}
