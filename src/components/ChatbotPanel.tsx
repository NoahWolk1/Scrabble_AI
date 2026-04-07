import { useMemo, useRef, useState } from 'react';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface ChatbotPanelProps {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  voiceAutoSendEnabled: boolean;
  setVoiceAutoSendEnabled: (enabled: boolean) => void;
  geminiVoiceEnabled: boolean;
  setGeminiVoiceEnabled: (enabled: boolean) => void;
  geminiVoiceSupported: boolean;
  geminiVoiceStatus: string;
}

export function ChatbotPanel({
  enabled,
  setEnabled,
  messages,
  loading,
  onSend,
  onClear,
  voiceAutoSendEnabled,
  setVoiceAutoSendEnabled,
  geminiVoiceEnabled,
  setGeminiVoiceEnabled,
  geminiVoiceSupported,
  geminiVoiceStatus,
}: ChatbotPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const canSend = enabled && !loading && draft.trim().length > 0;

  const rendered = useMemo(() => {
    return messages.map((m, idx) => (
      <div
        key={idx}
        className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
          m.role === 'user'
            ? 'bg-blue-600 text-white ml-10'
            : 'bg-white/70 dark:bg-stone-800/50 text-stone-900 dark:text-stone-100 mr-10 border border-stone-200/60 dark:border-stone-700/60'
        }`}
      >
        {m.content}
      </div>
    ));
  }, [messages]);

  return (
    <div className="mt-4 rounded-2xl bg-white/60 dark:bg-stone-900/30 border border-stone-200/60 dark:border-stone-700/60 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-200/60 dark:border-stone-700/60">
        <div className="flex items-center gap-3">
          <div className="font-semibold text-stone-900 dark:text-stone-100">AI Chat</div>
          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300 select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-blue-600"
            />
            Enabled
          </label>
          <label className={`flex items-center gap-2 text-sm select-none ${enabled ? 'text-stone-700 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500'}`}>
            <input
              type="checkbox"
              checked={voiceAutoSendEnabled}
              disabled={!enabled}
              onChange={(e) => setVoiceAutoSendEnabled(e.target.checked)}
              className="accent-emerald-600"
            />
            Auto-send voice
          </label>
          <label
            className={`flex items-center gap-2 text-sm select-none ${
              enabled && geminiVoiceSupported ? 'text-stone-700 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500'
            }`}
            title={
              geminiVoiceSupported
                ? 'Uses Gemini to transcribe mic audio (higher accuracy than browser speech recognition).'
                : 'Gemini Voice not supported in this browser.'
            }
          >
            <input
              type="checkbox"
              checked={geminiVoiceEnabled}
              disabled={!enabled || !geminiVoiceSupported}
              onChange={(e) => setGeminiVoiceEnabled(e.target.checked)}
              className="accent-purple-600"
            />
            Gemini Voice
            {geminiVoiceEnabled && (
              <span className="text-xs text-stone-500 dark:text-stone-400">({geminiVoiceStatus})</span>
            )}
          </label>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={loading || messages.length === 0}
          className="text-sm px-3 py-1.5 rounded-lg bg-stone-200/80 dark:bg-stone-700/60 text-stone-800 dark:text-stone-100 disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <div ref={listRef} className="max-h-[35vh] overflow-auto px-4 py-3 flex flex-col gap-2">
        {messages.length === 0 ? (
          <div className="text-sm text-stone-600 dark:text-stone-400">
            {enabled
              ? 'Ask about the current board, request move suggestions, or talk like a player.'
              : 'Enable AI Chat to talk to the assistant.'}
          </div>
        ) : (
          rendered
        )}
        {loading && (
          <div className="text-sm text-stone-600 dark:text-stone-400">Thinking…</div>
        )}
      </div>

      <form
        className="px-4 py-3 border-t border-stone-200/60 dark:border-stone-700/60 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          const t = draft.trim();
          setDraft('');
          onSend(t);
        }}
      >
        <input
          type="text"
          value={draft}
          disabled={!enabled || loading}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={enabled ? 'Type a message…' : 'Enable AI Chat to type…'}
          className="flex-1 px-3 py-2 rounded-xl bg-white/80 dark:bg-stone-800/60 border border-stone-200/80 dark:border-stone-700/60 text-stone-900 dark:text-stone-100 outline-none"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="px-4 py-2 rounded-xl font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
        >
          Send
        </button>
      </form>
    </div>
  );
}

