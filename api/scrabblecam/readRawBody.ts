import type { IncomingMessage } from 'node:http';
import { buffer } from 'node:stream/consumers';
import type { VercelRequest } from '@vercel/node';

/**
 * Buffer the raw request body. Prefer `stream/consumers.buffer` over manual
 * `data`/`end` listeners so we do not miss chunks on Vercel / Fluid.
 */
export function readRawBody(req: VercelRequest): Promise<Buffer> {
  return buffer(req as IncomingMessage);
}
