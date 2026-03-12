import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import { readFile } from 'fs/promises';
import FormData from 'form-data';

// Disable body parser for multipart
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 }); // 10MB
    const [_fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file?.[0];

    if (!file?.filepath) {
      return res.status(400).json({ status: 'ERROR', message: 'No file uploaded' });
    }

    const buffer = await readFile(file.filepath);

    const formData = new FormData();
    formData.append('file', buffer, {
      filename: file.originalFilename ?? 'board.jpg',
      contentType: file.mimetype ?? 'image/jpeg',
    });

    const scrabblecamRes = await fetch('https://scrabblecam.com/process', {
      method: 'POST',
      body: formData as unknown as BodyInit,
      headers: formData.getHeaders() as HeadersInit,
    });

    let data: { status: string; board?: string | null; message?: string };
    try {
      data = (await scrabblecamRes.json()) as typeof data;
    } catch {
      data = { status: 'ERROR', message: `Scrabblecam returned ${scrabblecamRes.status}` };
    }

    res.status(scrabblecamRes.status).json(data);
  } catch (err) {
    console.error('Scrabblecam proxy error:', err);
    res.status(500).json({ status: 'ERROR', message: 'Proxy failed' });
  }
}
