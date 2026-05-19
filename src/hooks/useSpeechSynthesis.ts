let voicesPrimed = false;

const TTS_URL = '/api/elevenlabs/tts';

/** Tiny valid WAV — played on user gesture to unlock HTMLAudioElement on iOS Safari. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';

let playbackAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;
let currentObjectUrl: string | null = null;

function getPlaybackAudio(): HTMLAudioElement {
  if (!playbackAudio) {
    playbackAudio = new Audio();
    playbackAudio.setAttribute('playsinline', 'true');
    playbackAudio.preload = 'auto';
  }
  return playbackAudio;
}

function revokeCurrentObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

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
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
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
    utterance.onerror = () => options.onEnd?.();
  }
  synth.speak(utterance);
  return true;
}

async function speakElevenLabs(text: string, options?: { rate?: number; onEnd?: () => void }): Promise<boolean> {
  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const contentType = res.headers.get('Content-Type') ?? '';
    if (!res.ok || !contentType.includes('audio/')) {
      const errBody = contentType.includes('json') ? await res.text() : '';
      console.warn('[tts] ElevenLabs API failed', res.status, errBody.slice(0, 300));
      return false;
    }
    const blob = await res.blob();
    if (blob.size < 100) {
      console.warn('[tts] empty audio response');
      return false;
    }

    revokeCurrentObjectUrl();
    const objectUrl = URL.createObjectURL(blob);
    currentObjectUrl = objectUrl;

    const audio = getPlaybackAudio();
    audio.volume = 1;
    const rate = options?.rate ?? 0.95;
    audio.playbackRate = Math.min(2, Math.max(0.5, rate));
    audio.onended = () => {
      revokeCurrentObjectUrl();
      options?.onEnd?.();
    };
    audio.onerror = () => {
      revokeCurrentObjectUrl();
      console.warn('[tts] audio element error');
      options?.onEnd?.();
    };

    audio.src = objectUrl;
    try {
      await audio.play();
      return true;
    } catch (playErr) {
      console.warn('[tts] audio.play() blocked — try tapping the screen first', playErr);
      revokeCurrentObjectUrl();
      return false;
    }
  } catch (err) {
    console.warn('[tts] fetch failed', err);
    return false;
  }
}

/** Prefer ElevenLabs TTS via same-origin API; fall back to browser speech synthesis. */
export function speak(text: string, options?: { rate?: number; onEnd?: () => void }) {
  if (typeof window === 'undefined') return;
  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    const audio = playbackAudio;
    if (audio) {
      audio.pause();
    }
    revokeCurrentObjectUrl();
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
 * Call from a user gesture (tap) before async TTS. Unlocks HTML5 audio on iOS Safari
 * and resumes the browser speech engine.
 */
export function unlockSpeech() {
  if (typeof window === 'undefined') return;

  const audio = getPlaybackAudio();
  if (!audioUnlocked) {
    const prevSrc = audio.src;
    const prevVol = audio.volume;
    audio.volume = 0.001;
    audio.src = SILENT_WAV;
    void audio
      .play()
      .then(() => {
        audioUnlocked = true;
        audio.pause();
        audio.currentTime = 0;
        audio.volume = prevVol || 1;
        if (prevSrc && prevSrc !== SILENT_WAV) audio.src = prevSrc;
        else audio.removeAttribute('src');
      })
      .catch(() => {
        /* still try speech synthesis below */
      });
  }

  if (window.speechSynthesis) {
    primeVoices(window.speechSynthesis);
    try {
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
  }
}

/** One-time unlock on first tap anywhere (helps before chat/async replies). */
export function installSpeechUnlockOnFirstGesture() {
  if (typeof document === 'undefined') return () => {};
  const handler = () => {
    unlockSpeech();
    document.removeEventListener('touchstart', handler, true);
    document.removeEventListener('click', handler, true);
  };
  document.addEventListener('touchstart', handler, true);
  document.addEventListener('click', handler, true);
  return () => {
    document.removeEventListener('touchstart', handler, true);
    document.removeEventListener('click', handler, true);
  };
}

export function stopSpeaking() {
  try {
    playbackAudio?.pause();
    revokeCurrentObjectUrl();
    if (playbackAudio) playbackAudio.removeAttribute('src');
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
