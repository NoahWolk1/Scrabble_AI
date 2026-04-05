import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function buildRecognizePrompt(priorGrid: (string | null)[][] | null): string {
  const base = `You are reading a Scrabble board from a photo. Extract the 15×15 grid of letters.

Coordinate system (critical — follow exactly):
- Indices are 0-based: row 0 = TOP edge of the board, row 14 = BOTTOM. Column 0 = LEFT edge, column 14 = RIGHT.
- The center premium star square is at row 7, column 7. Use it to align: that cell is the middle of the 15×15 grid.
- First JSON row = top row of the board; first cell in each row = leftmost column.

Rules:
- Empty cell = "" (empty string)
- Letter tile = single uppercase letter (A-Z)
- Blank/wildcard tile = "?"
- Common OCR confusions: O vs 0, I vs 1/l, S vs 5, E vs F, R vs K.
- The board may be at an angle—still map each tile to the correct row/column index as above.`;

  if (priorGrid && priorGrid.length === 15) {
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

Output ONLY a JSON array of exactly 15 rows. Each row is an array of exactly 15 cells.
Return ONLY valid JSON. No markdown, no explanation.`;
  }

  return `${base}

Output ONLY a JSON array of exactly 15 rows. Each row is an array of exactly 15 cells.
Example format: [["","","H","I","",""],...]

Return ONLY valid JSON. No markdown, no explanation.`;
}

function tryParseGridJson(str: string): (string | null)[][] | null {
  const cleaned = str.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const p = JSON.parse(cleaned);
    return Array.isArray(p) && p.length === 15 ? p : null;
  } catch {
    return null;
  }
}

function normalizeGrid(parsed: unknown[][]): (string | null)[][] {
  return (parsed ?? []).slice(0, 15).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, 15).map((c) => {
      if (c === null || c === undefined || c === '') return null;
      if (c === '?' || c === ' ') return ' ';
      const s = String(c).trim();
      return s.length === 1 && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
    })
  );
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
    const { image, mimeType = 'image/jpeg', priorBoard } = req.body as {
      image?: string;
      mimeType?: string;
      priorBoard?: (string | null)[][];
    };
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ status: 'ERROR', message: 'Missing image (base64)' });
    }

    const priorGrid =
      Array.isArray(priorBoard) && priorBoard.length === 15
        ? priorBoard
        : null;

    const prompt = buildRecognizePrompt(priorGrid);

    const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
                  data: image.replace(/^data:image\/\w+;base64,/, ''),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Gemini Vision API error:', response.status, err.slice(0, 200));
      return res.status(502).json({ status: 'ERROR', message: `Gemini API error: ${response.status}` });
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!text) {
      return res.status(502).json({ status: 'ERROR', message: 'Empty response from Gemini' });
    }

    const parsed = tryParseGridJson(text);
    if (!parsed || parsed.length !== 15) {
      return res.status(502).json({ status: 'ERROR', message: 'Could not parse board from response' });
    }

    const grid = normalizeGrid(parsed);
    return res.status(200).json({ status: 'OK', grid });
  } catch (err) {
    console.error('Recognize board error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Recognition failed',
    });
  }
}
