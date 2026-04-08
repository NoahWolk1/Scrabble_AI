let voicesPrimed = false;

function primeVoices(synth: SpeechSynthesis) {
  if (voicesPrimed) return;
  voicesPrimed = true;
  try {
    synth.getVoices();
  } catch {
    /* ignore */
  }
  synth.addEventListener?.('voiceschanged', () => {
    try {
      synth.getVoices();
    } catch {
      /* ignore */
    }
  });
}

export function speak(text: string, options?: { rate?: number; onEnd?: () => void }) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  const synth = window.speechSynthesis;
  primeVoices(synth);

  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
  try {
    synth.resume();
  } catch {
    /* ignore */
  }

  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.rate = options?.rate ?? 0.95;
  utterance.lang = 'en-US';
  if (options?.onEnd) {
    utterance.onend = options.onEnd;
  }
  synth.speak(utterance);
}

/**
 * Prime speech from a recent user gesture (tap, mic, etc.). Some browsers ignore
 * volume-0 or empty-string utterances; a tiny non-empty inaudible token is more reliable.
 * The next `speak()` call will `cancel()` this, which is fine — the real line still plays.
 */
export function unlockSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  primeVoices(synth);
  try {
    synth.resume();
  } catch {
    /* ignore */
  }
  const u = new SpeechSynthesisUtterance('\u00A0');
  u.volume = 0.01;
  u.rate = 16;
  try {
    synth.speak(u);
  } catch {
    /* ignore */
  }
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
