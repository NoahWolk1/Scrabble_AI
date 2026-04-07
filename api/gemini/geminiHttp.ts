/** Parse Google Generative Language API error JSON for logs and client `detail`. */
export function parseGeminiErrorBody(raw: string): {
  detail: string;
  code?: number;
  status?: string;
  full?: unknown;
} {
  let detail = raw.slice(0, 2000);
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; code?: number; status?: string; details?: unknown };
    };
    if (j.error?.message) detail = j.error.message;
    return {
      detail,
      code: j.error?.code,
      status: j.error?.status,
      full: j.error,
    };
  } catch {
    return { detail };
  }
}
