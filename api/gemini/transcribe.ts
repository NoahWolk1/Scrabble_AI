import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseGeminiErrorBody } from './geminiHttp';

const GEMINI_API =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const LOG = '[gemini-api:transcribe]';

/** Gemini is picky about audio MIME strings; strip codec params if needed. */
function normalizeAudioMimeType(m: string): string {
  const s = m.trim().toLowerCase();
  if (s.startsWith('audio/webm')) return 'audio/webm';
  if (s.startsWith('audio/ogg')) return 'audio/ogg';
  if (s.startsWith('audio/mp4') || s.startsWith('audio/m4a')) return 'audio/mp4';
  if (s.startsWith('audio/wav') || s.startsWith('audio/wave')) return 'audio/wav';
  const base = s.split(';')[0]?.trim();
  return base || 'audio/webm';
}

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
    const rawMt =
      typeof mimeType === 'string' && mimeType.length > 0 ? mimeType : 'audio/webm;codecs=opus';
    const mt = normalizeAudioMimeType(rawMt);

    const dataClean = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
    const prompt = buildTranscribePrompt(gameState);

    console.log(LOG, 'request', {
      mimeTypeRaw: rawMt,
      mimeTypeSent: mt,
      base64Chars: dataClean.length,
      promptChars: prompt.length,
    });

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
                  data: dataClean,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
          // Omit responseMimeType — some API/model combos return 400 with application/json here.
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const parsed = parseGeminiErrorBody(errText);
      console.error(LOG, 'Gemini HTTP error', {
        status: response.status,
        detail: parsed.detail,
        code: parsed.code,
        statusField: parsed.status,
        rawSnippet: errText.slice(0, 800),
      });
      return res.status(502).json({
        status: 'ERROR',
        message: `Gemini API error: ${response.status}`,
        detail: parsed.detail,
        geminiCode: parsed.code,
        geminiStatus: parsed.status,
      });
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

