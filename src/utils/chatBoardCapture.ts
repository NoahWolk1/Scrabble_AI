/** User/assistant wording that a human move was just made and the board may have changed. */
export function textHintsHumanPlayedMove(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(done|finished|i'?m done|i am done|all set|that'?s my move)\b/.test(t) ||
    /\b(i |we )?(played|placed|put|laid|went with)\b/.test(t) ||
    /\b(move is (on|in|placed)|made my move|took my turn)\b/.test(t) ||
    /\b(captured|recapture|took a (photo|picture)|snap(ped)? the board)\b/.test(t) ||
    /\b(scored|got \d+ points?|for \d+ points)\b/.test(t) ||
    /\b(your turn|you can go|go ahead)\b/.test(t)
  );
}

/** User/assistant wording that the AI / opponent should play next. */
export function textHintsAiShouldMove(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(ai|computer|opponent)['']?s turn\b/.test(t) ||
    /\b(it'?s|its) (the )?(ai|computer|opponent)['']?s turn\b/.test(t) ||
    /\bturn (for|to) (the )?(ai|computer|opponent)\b/.test(t) ||
    /\bwhen (does|will|should) (the )?(ai|computer|opponent) (play|move|go)\b/.test(t) ||
    /\b(let|make|have) (the )?(ai|computer|opponent) (play|move|go)\b/.test(t) ||
    /\b(ai|computer|opponent) (to )?(play|move|go|take a turn)\b/.test(t) ||
    /\b(play your move|take your turn)\b/.test(t)
  );
}

/** Whether chat should trigger a board capture to refresh game state. */
export function shouldCaptureBoardForChatContext(params: {
  userText: string;
  assistantText?: string | null;
  playAiMove?: boolean;
}): boolean {
  const { userText, assistantText, playAiMove } = params;
  if (playAiMove) return true;
  if (textHintsHumanPlayedMove(userText) || textHintsAiShouldMove(userText)) return true;
  if (assistantText) {
    if (textHintsHumanPlayedMove(assistantText) || textHintsAiShouldMove(assistantText)) return true;
  }
  return false;
}
