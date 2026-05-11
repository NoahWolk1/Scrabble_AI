import type { VercelRequest, VercelResponse } from '@vercel/node';

const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

const LOG = '[elevenlabs-api:transcribe]';

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

function normalizeAudioMimeType(m: string): string {
  const s = m.trim().toLowerCase();
  if (s.startsWith('audio/webm')) return 'audio/webm';
  if (s.startsWith('audio/ogg')) return 'audio/ogg';
  if (s.startsWith('audio/mp4') || s.startsWith('audio/m4a')) return 'audio/mp4';
  if (s.startsWith('audio/wav') || s.startsWith('audio/wave')) return 'audio/wav';
  const base = s.split(';')[0]?.trim();
  return base || 'audio/webm';
}

function filenameForMime(mt: string): string {
  if (mt.includes('webm')) return 'segment.webm';
  if (mt.includes('ogg')) return 'segment.ogg';
  if (mt.includes('wav')) return 'segment.wav';
  if (mt.includes('mp4') || mt.includes('m4a')) return 'segment.m4a';
  return 'segment.bin';
}

function extractTranscript(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  if (typeof d.text === 'string') return d.text.trim();
  if (Array.isArray(d.transcripts)) {
    const t0 = d.transcripts[0] as Record<string, unknown> | undefined;
    if (t0 && typeof t0.text === 'string') return t0.text.trim();
  }
  return '';
}

function extractLanguageProbability(data: unknown): number | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.language_probability === 'number') return d.language_probability;
  if (Array.isArray(d.transcripts)) {
    const t0 = d.transcripts[0] as Record<string, unknown> | undefined;
    if (t0 && typeof t0.language_probability === 'number') return t0.language_probability;
  }
  return undefined;
}

function confidenceFromLangProb(p: number | undefined): 'high' | 'medium' | 'low' {
  if (p == null || Number.isNaN(p)) return 'medium';
  if (p >= 0.9) return 'high';
  if (p >= 0.65) return 'medium';
  return 'low';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'ELEVENLABS_API_KEY not configured.',
    });
  }

  try {
    const body = readJsonBody(req);
    const { audioBase64, mimeType } = body as {
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
    const buf = Buffer.from(dataClean, 'base64');
    if (buf.length < 100) {
      return res.status(400).json({ status: 'ERROR', message: 'Audio too short' });
    }

    const modelId = process.env.ELEVENLABS_STT_MODEL_ID?.trim() || 'scribe_v1';
    const language = process.env.ELEVENLABS_STT_LANGUAGE?.trim() || 'en';

    const blob = new Blob([buf], { type: mt });
    const form = new FormData();
    form.append('model_id', modelId);
    form.append('file', blob, filenameForMime(mt));
    form.append('language_code', language);
    form.append('tag_audio_events', 'false');

    console.log(LOG, 'request', { mimeType: mt, bytes: buf.length, modelId });

    const elRes = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });

    const rawText = await elRes.text();
    if (!elRes.ok) {
      const snippet = rawText.replace(/\s+/g, ' ').slice(0, 400);
      console.error(LOG, 'ElevenLabs HTTP error', elRes.status, snippet);
      return res.status(502).json({
        status: 'ERROR',
        message: `ElevenLabs STT error: ${elRes.status}`,
        detail: snippet,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      return res.status(502).json({ status: 'ERROR', message: 'Invalid JSON from ElevenLabs STT' });
    }

    const transcript = extractTranscript(parsed);
    const confidence = confidenceFromLangProb(extractLanguageProbability(parsed));

    return res.status(200).json({ status: 'OK', transcript, confidence });
  } catch (err) {
    console.error(LOG, 'unhandled', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Transcription failed',
    });
  }
}
