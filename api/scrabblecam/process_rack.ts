import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchScrabblecam } from './fetchScrabblecam';

export const config = {
  api: { bodyParser: false },
};

/** Stream the request body to Scrabblecam without parsing. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const contentType = req.headers['content-type'];
  if (!contentType?.includes('multipart/form-data')) {
    return res.status(400).json({ status: 'ERROR', message: 'Expected multipart/form-data' });
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    if (body.length === 0) {
      return res.status(400).json({
        status: 'ERROR',
        rack: null,
        message: 'Empty request body (multipart image not received)',
      });
    }

    let scrabblecamRes: Awaited<ReturnType<typeof fetchScrabblecam>>;
    try {
      scrabblecamRes = await fetchScrabblecam('https://scrabblecam.com/process_rack', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(body.length),
        },
      });
    } catch (upstreamErr) {
      const m = upstreamErr instanceof Error ? upstreamErr.message : String(upstreamErr);
      console.error('Scrabblecam rack upstream fetch failed:', upstreamErr);
      return res.status(502).json({
        status: 'ERROR',
        rack: null,
        message: `Could not reach Scrabblecam: ${m}`,
      });
    }

    const rawText = await scrabblecamRes.text();
    let data: { status?: string; rack?: string | null; message?: string; error?: string };
    try {
      data = JSON.parse(rawText) as typeof data;
    } catch {
      const snippet = rawText.replace(/\s+/g, ' ').slice(0, 200).trim();
      return res.status(scrabblecamRes.status).json({
        status: 'ERROR',
        rack: null,
        message: snippet
          ? `Scrabblecam returned non-JSON (${scrabblecamRes.status}): ${snippet}${rawText.length > 200 ? '…' : ''}`
          : `Scrabblecam returned empty or non-JSON body (${scrabblecamRes.status})`,
      });
    }

    const msg =
      data?.message ??
      data?.error ??
      (scrabblecamRes.ok ? 'Unknown error' : `Request failed: ${scrabblecamRes.status}`);
    const out = {
      status: data?.status ?? (scrabblecamRes.ok ? 'OK' : 'ERROR'),
      rack: data?.rack ?? null,
      message: msg,
    };

    res.status(scrabblecamRes.status).json(out);
  } catch (err) {
    console.error('Scrabblecam rack proxy error:', err);
    const m = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'ERROR', rack: null, message: `Proxy failed: ${m}` });
  }
}
