/** Strip common markdown so browser TTS reads naturally. */
export function stripMarkdownForSpeech(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
}
