let voicesPrimed = false;

const TTS_URL = '/api/elevenlabs/tts';

let currentAudio: HTMLAudioElement | null = null;

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

function speakBrowser(text: string, options?: { rate?: number; onEnd?: () => void }) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
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
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options?.rate ?? 0.95;
  utterance.lang = 'en-US';
  if (options?.onEnd) {
    utterance.onend = options.onEnd;
  }
  synth.speak(utterance);
}

async function speakElevenLabs(text: string, options?: { rate?: number; onEnd?: () => void }): Promise<boolean> {
  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok || !res.headers.get('Content-Type')?.includes('audio/')) {
      return false;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio();
    currentAudio = audio;
    const rate = options?.rate ?? 0.95;
    audio.playbackRate = Math.min(2, Math.max(0.5, rate));
    audio.src = objectUrl;
    audio.onended = () => {
      URL.revokeObjectURL(objectUrl);
      if (currentAudio === audio) currentAudio = null;
      options?.onEnd?.();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      if (currentAudio === audio) currentAudio = null;
      options?.onEnd?.();
    };
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

/** Prefer ElevenLabs TTS via same-origin API; fall back to browser speech synthesis. */
export function speak(text: string, options?: { rate?: number; onEnd?: () => void }) {
  if (typeof window === 'undefined') return;
  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
  } catch {
    /* ignore */
  }
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }

  void (async () => {
    const ok = await speakElevenLabs(trimmed, options);
    if (!ok) speakBrowser(trimmed, options);
  })();
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
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = '';
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
