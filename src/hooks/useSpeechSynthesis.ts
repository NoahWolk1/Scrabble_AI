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
 * Call from a user gesture before async chat TTS. High-rate or “silent” primer
 * utterances sound like buzzing on some phones — we only resume the engine.
 */
export function unlockSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  primeVoices(window.speechSynthesis);
  try {
    window.speechSynthesis.resume();
  } catch {
    /* ignore */
  }
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
