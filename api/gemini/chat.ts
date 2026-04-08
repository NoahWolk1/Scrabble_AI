import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_API =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const LOG = '[gemini-api:chat]';

/** Enough room for move suggestions with word + score + coords without mid-sentence cutoffs. */
const CHAT_MAX_OUTPUT_TOKENS = 768;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function parseGeminiErrorBody(raw: string): {
  detail: string;
  code?: number;
  status?: string;
} {
  let detail = raw.slice(0, 2000);
  try {
    const j = JSON.parse(raw) as { error?: { message?: string; code?: number; status?: string } };
    if (j.error?.message) detail = j.error.message;
    return { detail, code: j.error?.code, status: j.error?.status };
  } catch {
    return { detail };
  }
}

function safeJsonForPrompt(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  } catch {
    return '"[game state unavailable]"';
  }
}

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

function systemPrompt(gameState: unknown): string {
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
${safeJsonForPrompt(gameState)}
`;
}

function parseChatModelOutput(raw: string): { reply: string; playAiMove: boolean } {
  const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
  try {
    const p = JSON.parse(cleaned) as { reply?: unknown; playAiMove?: unknown };
    const reply = typeof p.reply === 'string' ? p.reply.trim() : '';
    const playAiMove = p.playAiMove === true;
    if (reply.length > 0) return { reply, playAiMove };
  } catch {
    // fall through
  }
  return { reply: raw.trim(), playAiMove: false };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'ERROR', message: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'GEMINI_API_KEY not configured.',
    });
  }

  try {
    const body = readJsonBody(req);
    const { messages, gameState } = body as {
      messages?: ChatMessage[];
      gameState?: unknown;
    };

    const safeMessages = Array.isArray(messages) ? messages.slice(-20) : [];

    if (safeMessages.length === 0) {
      console.warn(LOG, 'reject: empty messages[]');
      return res.status(400).json({ status: 'ERROR', message: 'messages must include at least one entry' });
    }

    // Gemini REST API only accepts roles "user" and "model" (not "assistant").
    // Use systemInstruction so we don't stack two "user" turns (system + first message).
    const contents = safeMessages.map((m) => {
      const text = String(m.content ?? '').trim();
      return {
        role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: text.length > 0 ? text : '(empty message)' }],
      };
    });

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt(gameState) }],
      },
      contents,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      },
    };

    const systemLen = payload.systemInstruction.parts[0]?.text?.length ?? 0;
    console.log(LOG, 'request', {
      messageCount: safeMessages.length,
      contentsRoles: contents.map((c) => c.role),
      systemInstructionChars: systemLen,
      firstUserPreview: contents[0]?.parts?.[0]?.text?.slice(0, 80),
    });

    let response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok && response.status === 400) {
      const errText = await response.text();
      const parsed400 = parseGeminiErrorBody(errText);
      console.warn(LOG, '400 from Gemini — retrying without systemInstruction (merged into first user turn)', {
        detail: parsed400.detail,
      });
      const sys = systemPrompt(gameState);
      const first = contents[0];
      const rest = contents.slice(1);
      const firstText = first?.parts?.[0]?.text ?? '';
      const mergedFirst: { role: 'user'; parts: { text: string }[] } = {
        role: 'user',
        parts: [{ text: `${sys}\n\nUser:\n${firstText}` }],
      };
      const retryPayload = {
        contents: [mergedFirst, ...rest],
        generationConfig: payload.generationConfig,
      };
      response = await fetch(`${GEMINI_API}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryPayload),
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      const parsed = parseGeminiErrorBody(errText);
      console.error(LOG, 'Gemini HTTP error', {
        status: response.status,
        detail: parsed.detail,
        code: parsed.code,
        statusField: parsed.status,
        rawSnippet: errText.slice(0, 800),
      });
      return res.status(502).json({
        status: 'ERROR',
        message: `Gemini API error: ${response.status}`,
        detail: parsed.detail,
        geminiCode: parsed.code,
        geminiStatus: parsed.status,
      });
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return res.status(502).json({ status: 'ERROR', message: 'Empty response from Gemini' });

    const { reply, playAiMove } = parseChatModelOutput(text);
    if (!reply) return res.status(502).json({ status: 'ERROR', message: 'Could not parse chat reply from model' });

    return res.status(200).json({ status: 'OK', reply, playAiMove });
  } catch (err) {
    console.error('Gemini chat error:', err);
    return res.status(500).json({
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Chat failed',
    });
  }
}

