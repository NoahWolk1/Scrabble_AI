import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_CHARS = 2500;

function readJsonBody(req: VercelRequest): Record<string, unknown> {
  const b = req.body as unknown;
  if (b == null) return {};
  if (typeof b === 'string') {
    try {
      return JSON.parse(b) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof b === 'object') return b as Record<string, unknown>;
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) {
    return res.status(501).json({
      status: 'ERROR',
      message: 'ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must be set for TTS.',
    });
  }

  try {
    const body = readJsonBody(req);
    const textRaw = typeof body.text === 'string' ? body.text.trim() : '';
    if (!textRaw) {
      return res.status(400).json({ status: 'ERROR', message: 'Missing text' });
    }
    const text = textRaw.length > MAX_CHARS ? `${textRaw.slice(0, MAX_CHARS)}…` : textRaw;

    const modelId = process.env.ELEVENLABS_TTS_MODEL_ID?.trim() || 'eleven_turbo_v2_5';
    const outputFormat = process.env.ELEVENLABS_TTS_OUTPUT_FORMAT?.trim() || 'mp3_44100_128';

    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
    url.searchParams.set('output_format', outputFormat);

    const elRes = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
    });

    if (!elRes.ok) {
      const errText = await elRes.text();
      const snippet = errText.replace(/\s+/g, ' ').slice(0, 400);
      return res.status(502).json({
        status: 'ERROR',
        message: `ElevenLabs TTS error: ${elRes.status}`,
        detail: snippet,
      });
    }

    const audioBuf = Buffer.from(await elRes.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(audioBuf);
  } catch (err) {
    console.error('[elevenlabs-api:tts]', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'TTS failed',
    });
  }
}
