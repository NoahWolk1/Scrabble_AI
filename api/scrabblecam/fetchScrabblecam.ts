import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Scrabblecam has served an expired HTTPS certificate; browsers can click through,
 * but Node's fetch rejects it. This agent disables verification only for requests
 * we send explicitly to https://scrabblecam.com (never as a global default).
 */
const scrabblecamAgent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const ORIGIN = 'https://scrabblecam.com';

export function fetchScrabblecam(url: string, init?: RequestInit): Promise<Response> {
  if (!url.startsWith(`${ORIGIN}/`) && url !== ORIGIN) {
    throw new Error('fetchScrabblecam: only https://scrabblecam.com URLs are allowed');
  }
  return undiciFetch(url, { ...init, dispatcher: scrabblecamAgent });
}
