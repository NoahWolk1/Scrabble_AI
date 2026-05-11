import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchScrabblecam } from './fetchScrabblecam';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const { lang = 'EN', rack_str, board_str } = req.query;
  if (typeof rack_str !== 'string' || typeof board_str !== 'string') {
    return res.status(400).json({ status: 'ERROR', message: 'rack_str and board_str required' });
  }

  try {
    const params = new URLSearchParams({
      lang: String(lang),
      rack_str,
      board_str,
    });
    let scrabblecamRes: Awaited<ReturnType<typeof fetchScrabblecam>>;
    try {
      scrabblecamRes = await fetchScrabblecam(`https://scrabblecam.com/solve?${params}`);
    } catch (upstreamErr) {
      const m = upstreamErr instanceof Error ? upstreamErr.message : String(upstreamErr);
      console.error('Scrabblecam solve upstream fetch failed:', upstreamErr);
      return res.status(502).json({ status: 'ERROR', moves: [], message: `Could not reach Scrabblecam: ${m}` });
    }

    const rawText = await scrabblecamRes.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText) as unknown;
    } catch {
      const snippet = rawText.replace(/\s+/g, ' ').slice(0, 200).trim();
      return res.status(scrabblecamRes.status).json({
        status: 'ERROR',
        moves: [],
        message: snippet
          ? `Scrabblecam returned non-JSON (${scrabblecamRes.status}): ${snippet}${rawText.length > 200 ? '…' : ''}`
          : `Scrabblecam returned empty or non-JSON body (${scrabblecamRes.status})`,
      });
    }

    res.status(scrabblecamRes.status).json(data);
  } catch (err) {
    console.error('Scrabblecam solve proxy error:', err);
    const m = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'ERROR', moves: [], message: `Proxy failed: ${m}` });
  }
}
