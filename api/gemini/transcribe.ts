import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function buildTranscribePrompt(gameState: unknown): string {
  return `Transcribe the user's spoken audio into text.

Output MUST be valid JSON with this shape:
{"transcript": string, "confidence": "high"|"medium"|"low"}

Rules:
- Keep transcript exactly what the user said (light punctuation ok).
- If the audio is mostly silence/noise, transcript = "" and confidence="low".
- If unsure between similar words, choose the most likely given the Scrabble context below.

Scrabble context JSON (may help disambiguate commands like "done", "your turn", "recapture"):
${JSON.stringify(gameState)}
`;
}

function tryParseJson(s: string): { transcript: string; confidence: 'high' | 'medium' | 'low' } | null {
  const cleaned = s.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const p = JSON.parse(cleaned);
    if (!p || typeof p !== 'object') return null;
    const transcript = typeof (p as any).transcript === 'string' ? (p as any).transcript : '';
    const confidence = (p as any).confidence;
    if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;
    return { transcript, confidence };
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
      message: 'GEMINI_API_KEY not configured.',
    });
  }

  try {
    const { audioBase64, mimeType, gameState } = (req.body ?? {}) as {
      audioBase64?: string;
      mimeType?: string;
      gameState?: unknown;
    };
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ status: 'ERROR', message: 'Missing audioBase64' });
    }
    const mt =
      typeof mimeType === 'string' && mimeType.length > 0 ? mimeType : 'audio/webm;codecs=opus';

    const prompt = buildTranscribePrompt(gameState);

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
                  mime_type: mt,
                  data: audioBase64.replace(/^data:audio\/[^;]+;base64,/, ''),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Gemini Transcribe API error:', response.status, err.slice(0, 300));
      return res.status(502).json({ status: 'ERROR', message: `Gemini API error: ${response.status}` });
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return res.status(502).json({ status: 'ERROR', message: 'Empty response from Gemini' });

    const parsed = tryParseJson(text);
    if (!parsed) return res.status(502).json({ status: 'ERROR', message: 'Could not parse transcription JSON' });

    return res.status(200).json({ status: 'OK', ...parsed });
  } catch (err) {
    console.error('Gemini transcribe error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Transcription failed',
    });
  }
}

