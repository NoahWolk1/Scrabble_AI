/** True when the user is nudging the AI / opponent to take its turn (voice or text). */
export function wantsAiToTakeTurn(utterance: string): boolean {
  const t = utterance
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3) return false;

  const patterns: RegExp[] = [
    /\bgo ahead\b/,
    /\b(your turn|you'?re up|you go|take your turn)\b/,
    /\bmake your move\b/,
    /\b(ai|computer|opponent)\b.*\b(play|move|go)\b/,
    /\b(play|move)\b.*\b(ai|computer|opponent)\b/,
    /\bplay (your|a) (move|word)\b/,
    /\b(opponent'?s?|ai'?s?) turn\b/,
    /\bnow (play|move|go)\b/,
    /\b(it'?s|its) (your|the ai'?s?) turn\b/,
  ];

  return patterns.some((p) => p.test(t));
}
