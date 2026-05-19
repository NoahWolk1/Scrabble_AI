export type VoiceCommand =
  | 'play'
  | 'pass'
  | 'challenge'
  | 'my_turn'
  | 'suggest'
  | 'your_turn'
  | 'recapture'
  | null;

/** Normalize transcript for matching: lowercase, collapse punctuation/spaces. */
export function normalizeVoiceTranscript(t: string): string {
  return t.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchVoiceCommand(transcript: string): VoiceCommand {
  const t = normalizeVoiceTranscript(transcript);
  if (!t || t.length < 2) return null;

  if (/\brecapture\b/.test(t) || /\bre\s*capture\b/.test(t)) return 'recapture';

  if (/(?:your|you['\u2019]?re|you|ur|year|yaw|yor)\s*turn\b/.test(t)) return 'your_turn';
  if (/\b(?:done|don|dun|daughter|dawn|finish|finished|finishing|did\s*it)\b/.test(t)) return 'your_turn';
  if (/\b(?:i\s*am\s*done|i\s*m\s*done|im\s*done|i'm\s*done)\b/.test(t)) return 'your_turn';
  if (/\b(?:go|lets\s*go|let['\u2019]s\s*go|okay\s*go|ok\s*go|alright\s*go)\b/.test(t)) return 'your_turn';
  if (/\b(?:ready|complete|submitted|submit|next|got\s*it)\b/.test(t)) return 'your_turn';
  if (/\btake\s*(?:a\s*)?(?:picture|photo|shot|pick)\b/.test(t)) return 'your_turn';
  if (/\b(?:ok(?:ay)?|yeah|yes|yep)\s*(?:go|done|finish)\b/.test(t)) return 'your_turn';
  if (/\b(?:capture|snap|shoot)\b/.test(t)) return 'your_turn';
  if (/^(?:go|done|daughter|dawn|turn)$/.test(t)) return 'your_turn';

  if (/\bplay\b/.test(t)) return 'play';
  if (/\bpass\b/.test(t) || /\bpause\b/.test(t)) return 'pass';
  if (/\bchallenge\b/.test(t)) return 'challenge';
  if (/\bmy\s*turn\b/.test(t)) return 'my_turn';
  if (/\b(?:suggest|hint)\b/.test(t)) return 'suggest';
  return null;
}
