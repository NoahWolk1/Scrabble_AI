export function speak(text: string, options?: { rate?: number; onEnd?: () => void }) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  try {
    synth.resume();
  } catch {
    /* ignore */
  }
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options?.rate ?? 0.95;
  utterance.lang = 'en-US';
  if (options?.onEnd) {
    utterance.onend = options.onEnd;
  }
  synth.speak(utterance);
}

/** Warm up speech synthesis (some browsers pause the queue until resumed). */
export function unlockSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
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
