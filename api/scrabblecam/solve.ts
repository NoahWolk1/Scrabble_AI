import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    const scrabblecamRes = await fetch(`https://scrabblecam.com/solve?${params}`);
    const data = await scrabblecamRes.json();
    res.status(scrabblecamRes.status).json(data);
  } catch (err) {
    console.error('Scrabblecam solve proxy error:', err);
    res.status(500).json({ status: 'ERROR', message: 'Proxy failed' });
  }
}
