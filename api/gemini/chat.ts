import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function systemPrompt(gameState: unknown): string {
  return `You are ScrabbleMate, a friendly, competitive Scrabble co-player and coach.

You are chatting with a human who is playing a Scrabble game in a web app. You have up-to-date game state below as JSON.

Goals:
- Be extremely concise: reply in 1-2 short sentences (max ~25 words) unless the user explicitly asks for more detail.
- If the user asks for move suggestions, propose 1-3 moves with brief rationale. If move candidates are provided, prefer them.
- If it is the human's turn, acknowledge it and optionally suggest a next action.
- If it is the AI's turn, acknowledge it and optionally explain what the AI might do.
- Ask a short clarifying question only if you truly need it.

Constraints:
- Do NOT invent tiles that are not in the rack.
- Do NOT invent letters already on the board.
- When giving coordinates, use 0-based (row,col) indexes.

Current game state JSON:
${JSON.stringify(gameState)}
`;
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
    const { messages, gameState } = (req.body ?? {}) as {
      messages?: ChatMessage[];
      gameState?: unknown;
    };

    const safeMessages = Array.isArray(messages) ? messages.slice(-20) : [];

    // Gemini REST API only accepts roles "user" and "model" (not "assistant").
    // Use systemInstruction so we don't stack two "user" turns (system + first message).
    const contents = safeMessages.map((m) => {
      const text = String(m.content ?? '').trim();
      return {
        role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: text.length > 0 ? text : '(empty message)' }],
      };
    });

    const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt(gameState) }],
        },
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 220,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let detail = errText.slice(0, 400);
      try {
        const j = JSON.parse(errText) as { error?: { message?: string } };
        if (j.error?.message) detail = j.error.message;
      } catch {
        // keep raw slice
      }
      console.error('Gemini Chat API error:', response.status, detail);
      return res.status(502).json({
        status: 'ERROR',
        message: `Gemini API error: ${response.status}`,
        detail,
      });
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return res.status(502).json({ status: 'ERROR', message: 'Empty response from Gemini' });

    return res.status(200).json({ status: 'OK', reply: text });
  } catch (err) {
    console.error('Gemini chat error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Chat failed',
    });
  }
}

