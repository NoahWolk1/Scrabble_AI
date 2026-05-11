import https from 'node:https';
import { URL } from 'node:url';

const ORIGIN = 'https://scrabblecam.com';

export type ScrabblecamFetchResult = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const o: Record<string, string> = {};
    h.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }
  if (Array.isArray(h)) {
    const o: Record<string, string> = {};
    for (const [k, v] of h) o[k] = v;
    return o;
  }
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    o[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return o;
}

function bodyToBuffer(body: BodyInit | null | undefined): Buffer | undefined {
  if (body == null) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  throw new Error('fetchScrabblecam: unsupported body type (use Buffer)');
}

/**
 * HTTPS to scrabblecam.com with TLS verification disabled for that host only
 * (their cert has been invalid). Uses node:https instead of undici so Vercel
 * bundling does not trip FUNCTION_INVOCATION_FAILED.
 */
export function fetchScrabblecam(urlString: string, init?: RequestInit): Promise<ScrabblecamFetchResult> {
  if (!urlString.startsWith(`${ORIGIN}/`) && urlString !== ORIGIN) {
    throw new Error('fetchScrabblecam: only https://scrabblecam.com URLs are allowed');
  }

  const u = new URL(urlString);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = normalizeHeaders(init?.headers);
  const bodyBuf = bodyToBuffer(init?.body as BodyInit | undefined);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        rejectUnauthorized: false,
        servername: u.hostname,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (c) => {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        });
        incoming.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const status = incoming.statusCode ?? 500;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: async () => raw,
          });
        });
        incoming.on('error', reject);
      }
    );
    req.on('error', reject);
    if (bodyBuf?.length) req.write(bodyBuf);
    req.end();
  });
}
