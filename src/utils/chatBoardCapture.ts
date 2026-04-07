import type { Player } from '../game/types';

/** User/assistant wording that suggests focusing on the AI / whose turn is next. */
export function textHintsAtAiTurn(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(ai|computer|opponent)['']?s turn\b/.test(t) ||
    /\b(it'?s|its) (the )?(ai|computer|opponent)['']?s turn\b/.test(t) ||
    /\bturn (for|to) (the )?(ai|computer|opponent)\b/.test(t) ||
    /\bwhen (does|will) (the )?(ai|computer|opponent) (play|move|go)\b/.test(t) ||
    /\b(ai|computer|opponent) (to )?(play|move|go)\b/.test(t)
  );
}

/** Whether we should run a board capture to stay in sync while chatting about AI / turns. */
export function shouldCaptureBoardForChatContext(params: {
  currentPlayer: Player;
  userText: string;
  assistantText?: string | null;
}): boolean {
  const { currentPlayer, userText, assistantText } = params;
  if (currentPlayer === 'ai') return true;
  if (textHintsAtAiTurn(userText)) return true;
  if (assistantText && textHintsAtAiTurn(assistantText)) return true;
  return false;
}
