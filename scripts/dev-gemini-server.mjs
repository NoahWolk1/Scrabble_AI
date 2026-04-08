/**
 * Dev server for Gemini Vision board recognition.
 * Loads .env.local for GEMINI_API_KEY. Vite proxies /api/gemini to this server.
 */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const PORT = 3001;
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function tryParseGridJson(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    if (!e.message?.includes('JSON')) return null;
  }
  let repaired = str;
  const inString = (repaired.match(/"/g) || []).length % 2 === 1;
  if (inString) repaired += '"';
  let open = 0;
  for (const c of repaired) {
    if (c === '[') open++;
    else if (c === ']') open = Math.max(0, open - 1);
  }
  repaired += ']'.repeat(open);
  try {
    return JSON.parse(repaired);
  } catch {
    const rows = [];
    let rest = repaired.replace(/^\s*\[\s*/, '');
    for (let i = 0; i < 15 && rest.length; i++) {
      const m = rest.match(/^\s*\[([^\]]*)\]?\s*,?/);
      const raw = m ? m[1] : '';
      const cells = raw.split(',').map((c) => {
        const s = c.replace(/^["']|["']$/g, '').trim();
        if (!s || s === 'null') return null;
        if (s === '?' || s === ' ') return ' ';
        return s.length === 1 && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
      });
      const padded = cells.slice(0, 15);
      while (padded.length < 15) padded.push(null);
      rows.push(padded);
      rest = m ? rest.slice(m[0].length).replace(/^\s*,?\s*/, '') : '';
    }
    while (rows.length < 15) rows.push(Array(15).fill(null));
    return rows;
  }
}

function buildRecognizePrompt(priorGrid) {
  const base = `You are reading a Scrabble board from a photo. Extract the 15×15 grid of letters.
Coordinate system: 0-based indices. Row 0=TOP, row 14=BOTTOM. Col 0=LEFT, col 14=RIGHT.
Center star square is row 7, col 7 — use it to align the grid. First JSON row = top of board.
Empty="", letter=A-Z, blank="?". Confusions: O/0, I/1/l, S/5, E/F, R/K.`;
  if (priorGrid && Array.isArray(priorGrid) && priorGrid.length === 15) {
    const priorStr = JSON.stringify(
      priorGrid.map((row) =>
        (row ?? []).slice(0, 15).map((c) => (c === null || c === '' ? '' : c === ' ' ? '?' : c))
      )
    );
    return `${base}

IMPORTANT - USE THE PRIOR BOARD: The image shows the board after a move. The previous valid board state is provided below.
- Only 2–7 cells typically change per turn (one new word).
- Use the prior state as the DEFAULT for every cell.
- Only UPDATE cells where you clearly see NEW letters placed.
- Do NOT re-read the entire board—focus on what changed.
- If a cell is unclear or could be glare/noise, keep the prior value.

Previous board state (use as default):
${priorStr}

Output ONLY a JSON array of exactly 15 rows. Each row is an array of exactly 15 cells. No markdown.`;
  }
  return `${base}
Output ONLY a JSON array of 15 rows, each 15 cells. No markdown.`;
}

function normalizeRecognizedGrid(parsed) {
  return (parsed ?? []).slice(0, 15).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, 15).map((c) => {
      if (c === null || c === undefined || c === '') return null;
      if (c === '?' || c === ' ') return ' ';
      const s = String(c).trim();
      return s.length === 1 && /[A-Za-z]/.test(s) ? s.toUpperCase() : null;
    })
  );
}

async function recognizeBoard(imageBase64, mimeType, apiKey, priorBoard) {
  const prompt = buildRecognizePrompt(priorBoard);
  const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) throw new Error(`Gemini API: ${response.status}`);

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');

  const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
  let parsed = tryParseGridJson(cleaned);
  if (!parsed || !Array.isArray(parsed) || parsed.length !== 15) throw new Error('Could not parse grid');

  return normalizeRecognizedGrid(parsed);
}

async function geminiGenerateText(apiKey, parts, temperature = 0.4, maxOutputTokens = 1024) {
  const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, maxOutputTokens },
    }),
  });
  if (!response.ok) throw new Error(`Gemini API: ${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

function systemChatPrompt(gameState) {
  return `You are ScrabbleMate, a friendly Scrabble helper in a web app. You have game state JSON below (includes currentPlayer: "human" | "ai").

OUTPUT FORMAT (mandatory): ONLY valid JSON, no markdown, no extra text:
{"reply": string, "playAiMove": boolean}

Field "reply": Short conversational text (1-4 sentences). Plain text only (no markdown). Never stop mid-sentence.

Field "playAiMove": true ONLY when the user's latest message is directing the AI/computer/opponent to take its turn NOW. Examples: "your turn", "it's your turn", "go ahead", "play", "take your turn" — these mean the human is talking TO the AI, not claiming their own turn. Set playAiMove false for greetings, rules questions, or when they are not asking the AI to move.

When playAiMove is true: reply with a brief acknowledgment that you will play (e.g. "Got it—playing now." or "On it."). Do NOT say "it's my turn" in a way that sounds like the human is taking a turn. Do NOT describe a specific move or tile play in the reply unless the user asked for move help.

Move suggestions — STRICT: Do NOT suggest specific words, scores, or placements unless the user clearly asks for help with a move (e.g. asks what to play, for a suggestion, best move, or ideas). Never volunteer move ideas just because it is someone's turn.

General chat: rules, scoring, strategy without naming a board play are OK. Keep replies short unless the user asks for detail.

Constraints:
- Do NOT invent tiles that are not in the rack.
- Do NOT invent letters already on the board.
- When giving coordinates (only if the user asked for move help), use 0-based (row,col) indexes.

Current game state JSON:
${JSON.stringify(gameState)}
`;
}

function parseChatModelOutput(raw) {
  const cleaned = String(raw).replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const p = JSON.parse(cleaned);
    const reply = typeof p.reply === 'string' ? p.reply.trim() : '';
    const playAiMove = p.playAiMove === true;
    if (reply.length > 0) return { reply, playAiMove };
  } catch {
    // ignore
  }
  return { reply: String(raw).trim(), playAiMove: false };
}

function transcribePrompt(gameState) {
  return `Transcribe the user's spoken audio into text.

Output MUST be valid JSON with this shape:
{"transcript": string, "confidence": "high"|"medium"|"low"}

Rules:
- Keep transcript exactly what the user said (light punctuation ok).
- If the audio is mostly silence/noise, transcript = "" and confidence="low".
- If unsure between similar words, choose the most likely given the Scrabble context below.

Scrabble context JSON:
${JSON.stringify(gameState)}
`;
}

function tryParseJson(s) {
  const cleaned = String(s || '').replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeAudioMimeType(m) {
  const s = String(m || '').trim().toLowerCase();
  if (s.startsWith('audio/webm')) return 'audio/webm';
  if (s.startsWith('audio/ogg')) return 'audio/ogg';
  if (s.startsWith('audio/mp4') || s.startsWith('audio/m4a')) return 'audio/mp4';
  const base = s.split(';')[0]?.trim();
  return base || 'audio/webm';
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = (req.url || '').split('?')[0];
  if (req.method !== 'POST' || (path !== '/recognize-board' && path !== '/chat' && path !== '/transcribe')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: 'Not found' }));
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: 'GEMINI_API_KEY not set. Create .env.local with GEMINI_API_KEY=your_key' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: 'Invalid JSON' }));
    return;
  }
  if (path === '/recognize-board') {
    const image = parsed?.image;
    const mimeType = parsed?.mimeType || 'image/jpeg';
    const priorBoard = Array.isArray(parsed?.priorBoard) && parsed.priorBoard.length === 15 ? parsed.priorBoard : null;
    if (!image || typeof image !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: 'Missing image (base64)' }));
      return;
    }
    try {
      const grid = await recognizeBoard(image, mimeType, apiKey, priorBoard);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', grid }));
    } catch (err) {
      console.warn('Gemini Vision recognize failed:', err?.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ status: 'ERROR', message: (err?.message || 'Recognition failed').replace(/[^\x20-\x7E]/g, '') })
      );
    }
    return;
  }

  if (path === '/transcribe') {
    const audioBase64 = parsed?.audioBase64;
    const mimeTypeRaw = parsed?.mimeType || 'audio/webm;codecs=opus';
    const gameState = parsed?.gameState ?? null;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: 'Missing audioBase64' }));
      return;
    }
    const mt = normalizeAudioMimeType(mimeTypeRaw);
    const dataClean = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
    console.log('[gemini-dev:transcribe]', { mimeTypeRaw, mimeTypeSent: mt, base64Chars: dataClean.length });
    try {
      const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: transcribePrompt(gameState) },
                { inline_data: { mime_type: mt, data: dataClean } },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        let detail = raw.slice(0, 800);
        try {
          const j = JSON.parse(raw);
          if (j?.error?.message) detail = j.error.message;
        } catch {
          // ignore
        }
        console.error('[gemini-dev:transcribe] Gemini HTTP error', response.status, detail);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', message: `Gemini API error: ${response.status}`, detail }));
        return;
      }
      const data = JSON.parse(raw);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) throw new Error('Empty Gemini response');
      const parsedJson = tryParseJson(text);
      if (!parsedJson || typeof parsedJson.transcript !== 'string') throw new Error('Bad JSON');
      const confidence = parsedJson.confidence;
      if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') throw new Error('Bad confidence');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', transcript: parsedJson.transcript, confidence }));
    } catch (err) {
      console.warn('Gemini transcribe failed:', err?.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: (err?.message || 'Transcribe failed').replace(/[^\x20-\x7E]/g, '') }));
    }
    return;
  }

  // /chat — match api/gemini/chat.ts (systemInstruction + user/model roles)
  const messages = Array.isArray(parsed?.messages) ? parsed.messages.slice(-20) : [];
  const gameState = parsed?.gameState ?? null;
  const contents = messages.map((m) => {
    const text = String(m?.content ?? '').trim();
    return {
      role: m?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: text.length > 0 ? text : '(empty message)' }],
    };
  });
  try {
    const response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemChatPrompt(gameState) }] },
        contents,
        generationConfig: { temperature: 0.35, maxOutputTokens: 768 },
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = raw.slice(0, 400);
      try {
        const j = JSON.parse(raw);
        if (j?.error?.message) detail = j.error.message;
      } catch {
        // ignore
      }
      console.warn('Gemini chat failed:', response.status, detail);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: `Gemini API error: ${response.status}`, detail }));
      return;
    }
    const data = JSON.parse(raw);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: 'Empty response from Gemini' }));
      return;
    }
    const { reply, playAiMove } = parseChatModelOutput(text);
    if (!reply) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', message: 'Could not parse chat reply from model' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', reply, playAiMove }));
  } catch (err) {
    console.warn('Gemini chat failed:', err?.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ERROR', message: (err?.message || 'Chat failed').replace(/[^\x20-\x7E]/g, '') }));
  }
  return;
});

server.listen(PORT, () => {
  console.log(`Gemini Vision dev server: http://localhost:${PORT}`);
});
