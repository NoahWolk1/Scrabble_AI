import type { VercelRequest, VercelResponse } from '@vercel/node';

// Disable body parser - we stream the raw body through
export const config = {
  api: {
    bodyParser: false,
  },
};

/** Stream the request body to Scrabblecam without parsing. Avoids formidable issues on Vercel. */
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

    const scrabblecamRes = await fetch('https://scrabblecam.com/process', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
      },
    });

    let data: { status?: string; board?: string | null; message?: string; error?: string };
    try {
      data = (await scrabblecamRes.json()) as typeof data;
    } catch {
      data = { status: 'ERROR', message: `Scrabblecam returned ${scrabblecamRes.status}` };
    }

    const msg = data?.message ?? data?.error ?? (scrabblecamRes.ok ? undefined : `Request failed: ${scrabblecamRes.status}`);
    const out = {
      status: data?.status ?? (scrabblecamRes.ok ? 'OK' : 'ERROR'),
      board: data?.board ?? null,
      message: msg,
    };

    res.status(scrabblecamRes.status).json(out);
  } catch (err) {
    console.error('Scrabblecam proxy error:', err);
    res.status(500).json({ status: 'ERROR', message: 'Proxy failed' });
  }
}
