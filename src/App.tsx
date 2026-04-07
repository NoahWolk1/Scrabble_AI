import { useEffect, useState, useRef, useCallback } from 'react';
import { Board } from './components/Board';
import { LetterPicker } from './components/LetterPicker';
import { BlankLetterModal } from './components/BlankLetterModal';
import { Rack } from './components/Rack';
import { GameControls } from './components/GameControls';
import { CameraView, type CameraViewRef } from './components/CameraView';
import { VoiceCaptureTrigger } from './components/VoiceCaptureTrigger';
import { ChatbotPanel, type ChatMessage } from './components/ChatbotPanel';
import { useGameStore } from './store/gameStore';
import { useCamera } from './hooks/useCamera';
import { speak, unlockSpeech } from './hooks/useSpeechSynthesis';
import { loadDictionary } from './game/loadDictionary';
import { generateMoves } from './game/MoveGenerator';
import { recognizeBoard } from './cv/BoardRecognizer';
import { boardRecLog } from './cv/boardRecognitionLog';
import { recognizeRackFromImage } from './cv/scrabblecamApi';
import { prepareImageForRecognition } from './cv/imageUtils';
import { useGeminiVoice } from './hooks/useGeminiVoice';
import { wantsAiToTakeTurn } from './utils/voiceAiIntent';
import { stripMarkdownForSpeech } from './utils/speechText';

function App() {
  const {
    board,
    humanRack,
    aiRack,
    scores,
    trie,
    currentPlayer: _currentPlayer,
    gameOver,
    initGame,
    playAIMove,
    setTrie,
    lastAIMove,
    validateRack,
    setValidateRack,
    loseTurnOnInvalidMove,
    setLoseTurnOnInvalidMove,
    setBoardCell,
    aiDifficulty,
    setAIDifficulty,
  } = useGameStore();
  const { stream, error, loading, startCamera, stopCamera } = useCamera();
  const [recognizing, setRecognizing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [debugRecognizedGrid, setDebugRecognizedGrid] = useState<(string | null)[][] | null>(null);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [voiceAutoSendEnabled, setVoiceAutoSendEnabled] = useState(true);
  const [geminiVoiceEnabled, setGeminiVoiceEnabled] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [blankLetterPrompt, setBlankLetterPrompt] = useState<{
    grid: (string | null)[][];
    pending: { row: number; col: number }[];
  } | null>(null);
  const setBoardFromRecognition = useGameStore((s) => s.setBoardFromRecognition);
  const setHumanRack = useGameStore((s) => s.setHumanRack);
  const applyHumanMoveFromBoardImage = useGameStore((s) => s.applyHumanMoveFromBoardImage);
  const undoLastTurn = useGameStore((s) => s.undoLastTurn);
  const canRecapture = useGameStore((s) => !!s._lastHumanTurnSnapshot);
  const lastAIMoveRef = useRef<unknown>(null);
  const cameraRef = useRef<CameraViewRef>(null);
  const recognizingRef = useRef(recognizing);
  recognizingRef.current = recognizing;
  const lastVoiceSentRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  /** Debounce AI "take your turn" nudges from voice or chat. */
  const lastAiTurnNudgeRef = useRef(0);

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    speak(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, []);

  const buildChatGameState = useCallback(() => {
    const s = useGameStore.getState();
    const validateMove = s.validateMove;
    const boardArr = s.board.toArray();
    const rack = [...s.humanRack];
    let moveCandidates: Array<{ word: string; score: number; row: number; col: number; direction: 'H' | 'V' }> = [];
    if (s.trie && s.currentPlayer === 'human' && !s.gameOver && rack.length > 0) {
      try {
        const moves = generateMoves(s.board, rack, s.trie, s.isFirstMove)
          .filter((m) => validateMove(m.tiles))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        moveCandidates = moves.map((m) => ({
          word: m.word,
          score: m.score,
          row: m.row,
          col: m.col,
          direction: m.direction === 'horizontal' ? 'H' : 'V',
        }));
      } catch {
        // Ignore move generation failures; chat still works without candidates.
      }
    }

    return {
      board: boardArr,
      humanRack: rack,
      aiRack: [...s.aiRack],
      scores: s.scores,
      currentPlayer: s.currentPlayer,
      isFirstMove: s.isFirstMove,
      gameOver: s.gameOver,
      status: s.status,
      lastAIMove: s.lastAIMove,
      moveCandidates,
    };
  }, []);

  const sendChat = useCallback(
    async (text: string) => {
      if (!chatEnabled || chatLoading) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      const gs = useGameStore.getState();
      if (gs.currentPlayer === 'ai' && !gs.gameOver && gs.trie && wantsAiToTakeTurn(trimmed)) {
        const now = Date.now();
        if (now - lastAiTurnNudgeRef.current < 2000) return;
        lastAiTurnNudgeRef.current = now;
        void playAIMove();
        return;
      }

      const userMsg: ChatMessage = { role: 'user', content: trimmed };
      const nextMessages = [...chatMessages, userMsg].slice(-30);
      setChatMessages(nextMessages);
      setChatLoading(true);
      try {
        const gameState = buildChatGameState();
        const resp = await fetch('/api/gemini/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: nextMessages, gameState }),
        });
        const rawText = await resp.text();
        let data: {
          status: 'OK' | 'ERROR';
          reply?: string;
          message?: string;
          detail?: string;
          geminiCode?: number;
          geminiStatus?: string;
        };
        try {
          data = JSON.parse(rawText) as typeof data;
        } catch {
          console.error('[gemini-client:chat] non-JSON response', resp.status, rawText.slice(0, 800));
          throw new Error(`Chat failed (${resp.status}): invalid JSON`);
        }
        if (!resp.ok || data.status !== 'OK' || !data.reply) {
          console.error('[gemini-client:chat] failed', {
            httpStatus: resp.status,
            status: data.status,
            message: data.message,
            detail: data.detail,
            geminiCode: data.geminiCode,
            geminiStatus: data.geminiStatus,
            bodyPreview: rawText.slice(0, 1200),
          });
          throw new Error(data.detail || data.message || `Chat failed (${resp.status})`);
        }
        const assistantMsg: ChatMessage = { role: 'assistant', content: data.reply ?? '' };
        setChatMessages((prev) => [...prev, assistantMsg].slice(-30));
        // Speak assistant replies out loud (browser TTS). Requires unlockSpeech() to have been
        // called from a user gesture at least once (the app already does this on key buttons).
        speak(stripMarkdownForSpeech(assistantMsg.content));
      } catch (err) {
        console.error('Chat send failed:', err);
        showToast(err instanceof Error ? err.message : 'Chat failed');
      } finally {
        setChatLoading(false);
      }
    },
    [buildChatGameState, chatEnabled, chatLoading, chatMessages, showToast, playAIMove]
  );

  const maybeAutoSendVoiceToChat = useCallback(
    (finalText: string) => {
      if (!chatEnabled || !voiceAutoSendEnabled) return;
      if (geminiVoiceEnabled) return; // when Gemini Voice is enabled, we use mic transcription instead
      const t = finalText.trim();
      if (!t) return;

      // Lightweight spam filter for mobile: ignore very short non-keyword utterances.
      const normalized = t.toLowerCase();
      const hasKeyIntent =
        /\b(suggest|move|play|best|score|where|what|why|how|should|turn|done|recapture|challenge|pass)\b/.test(normalized) ||
        normalized.endsWith('?');
      if (!hasKeyIntent && normalized.split(/\s+/).length < 3) return;

      const now = Date.now();
      const last = lastVoiceSentRef.current;
      if (now - last.at < 1500 && normalizeWhitespace(last.text) === normalizeWhitespace(t)) return;
      if (now - last.at < 1200) return;

      lastVoiceSentRef.current = { text: t, at: now };
      sendChat(t);
    },
    [chatEnabled, sendChat, voiceAutoSendEnabled, geminiVoiceEnabled]
  );

  function normalizeWhitespace(s: string): string {
    return s.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  const { supported: geminiVoiceSupported, status: geminiVoiceStatus } = useGeminiVoice({
    enabled: chatEnabled && geminiVoiceEnabled,
    buildGameState: buildChatGameState,
    onTranscript: ({ text, confidence }) => {
      // Keep it passive but avoid accidental noise-triggered sends.
      if (confidence === 'low') return;
      sendChat(text);
    },
  });

  const handleBoardImage = useCallback(
    async (file: Blob) => {
      setRecognizing(true);
      setToast(null);
      // Yield to browser so video can render next frame before we block
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      try {
        const prepared = await prepareImageForRecognition(file);
        const priorBoard = useGameStore.getState().board.toArray();
        const grid = await recognizeBoard(prepared, {
          priorBoard: priorBoard.every((r) => r.every((c) => !c)) ? null : priorBoard,
        });
        const isHumanTurn = useGameStore.getState().currentPlayer === 'human';
        if (isHumanTurn) {
          const result = applyHumanMoveFromBoardImage(grid);
          boardRecLog('applyHumanMoveFromBoardImage', {
            success: result.success,
            lostTurn: 'lostTurn' in result ? result.lostTurn : undefined,
            message: 'message' in result ? result.message : undefined,
            needsBlankLetters: 'needsBlankLetters' in result ? result.needsBlankLetters : undefined,
          });
          if (!result.success && 'needsBlankLetters' in result && result.needsBlankLetters) {
            setBlankLetterPrompt({ grid: result.grid, pending: result.pendingBlanks });
            setDebugRecognizedGrid(grid);
          } else if (!result.success) {
            setDebugRecognizedGrid(grid);
            showToast(
              'message' in result && result.message ? result.message : 'Recognition failed'
            );
          } else if (result.lostTurn) {
            setDebugRecognizedGrid(grid);
            showToast(
              'message' in result && result.message ? result.message : 'Invalid move—you lost your turn'
            );
          } else {
            setDebugRecognizedGrid(null);
          }
        } else {
          setBoardFromRecognition(grid);
        }
      } catch (err) {
        console.error('Recognition failed:', err);
        const msg = err instanceof Error ? err.message : 'Board recognition failed.';
        showToast(msg);
      } finally {
        setRecognizing(false);
      }
    },
    [applyHumanMoveFromBoardImage, setBoardFromRecognition, showToast]
  );

  const handleRackImage = useCallback(
    async (file: Blob) => {
      setRecognizing(true);
      setToast(null);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      try {
        const prepared = await prepareImageForRecognition(file);
        const res = await recognizeRackFromImage(prepared);
        if (res.status === 'OK' && res.rack) {
          const rack = res.rack.split(',').map((c) => (c.trim() === '?' ? ' ' : c.trim().toUpperCase()));
          setHumanRack(rack);
        } else {
          showToast(res.message ?? 'Rack recognition failed');
        }
      } catch (err) {
        console.error('Rack recognition failed:', err);
        showToast('Rack recognition failed. Try a clear photo of your tiles.');
      } finally {
        setRecognizing(false);
      }
    },
    [setHumanRack, showToast]
  );

  useEffect(() => {
    if (blankLetterPrompt) {
      speak('Choose the letter for your blank tile.');
    }
  }, [blankLetterPrompt]);

  useEffect(() => {
    loadDictionary().then((dict) => {
      setTrie(dict);
      initGame(dict);
    });
  }, [initGame, setTrie]);

  useEffect(() => {
    if (_currentPlayer === 'ai' && !gameOver && trie) {
      const timer = setTimeout(() => playAIMove(), 500);
      return () => clearTimeout(timer);
    }
  }, [_currentPlayer, gameOver, trie, playAIMove]);

  const humanTurnRef = useRef(false);
  useEffect(() => {
    if (lastAIMove && lastAIMove !== lastAIMoveRef.current) {
      lastAIMoveRef.current = lastAIMove;
      const rackLetters = humanRack.map((c) => (c === ' ' ? 'blank' : c)).join(', ');
      const rackAnnounce = humanRack.length > 0 ? ` Your letters are ${rackLetters}.` : '';
      if (lastAIMove.passed) {
        speak(`I pass. Your turn.${rackAnnounce}`);
      } else {
        const letters = lastAIMove.word.split('').join(' ');
        speak(`I play ${letters} for ${lastAIMove.score} points. Place my tiles on the board, then make your move and capture. Your turn.${rackAnnounce}`);
      }
    }
  }, [lastAIMove, humanRack]);

  useEffect(() => {
    if (_currentPlayer === 'human' && !gameOver && humanTurnRef.current === false) {
      humanTurnRef.current = true;
      // First turn (human goes first): announce rack only
      if (humanRack.length > 0 && !lastAIMove) {
        const letters = humanRack.map((c) => (c === ' ' ? 'blank' : c)).join(', ');
        speak(`Your letters are ${letters}.`);
      }
    } else if (_currentPlayer !== 'human') {
      humanTurnRef.current = false;
    }
  }, [_currentPlayer, gameOver, humanRack, lastAIMove]);

  useEffect(() => {
    if (_currentPlayer === 'human' && !gameOver && !stream) {
      startCamera();
    } else if (_currentPlayer !== 'human' || gameOver) {
      stopCamera();
    }
  }, [_currentPlayer, gameOver, startCamera, stopCamera, stream]);

  const scrollClass =
    'h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-none touch-pan-y bg-stone-100/95 dark:bg-stone-900/95';

  if (!trie) {
    return (
      <div className={`${scrollClass} flex items-center justify-center`}>
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <p className="text-stone-600 dark:text-stone-400">Loading dictionary...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${scrollClass} pb-24`}>
      <div className="max-w-xl mx-auto px-4">
        <header className="text-center py-5">
          <h1 className="font-display text-3xl font-bold text-stone-800 dark:text-stone-100 tracking-tight">
            Scrabble AI
          </h1>
        </header>

        <div className="space-y-5">
          {/* Score bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white dark:bg-stone-800/80 px-4 py-3 shadow-card dark:shadow-card-dark border border-stone-200/60 dark:border-stone-700/60">
            <div className="flex items-baseline gap-6">
              <span className="text-stone-700 dark:text-stone-300">
                <span className="font-semibold text-amber-700 dark:text-amber-400">You</span>
                <span className="ml-1.5 text-lg font-bold tabular-nums">{scores.human}</span>
              </span>
              <span className="text-stone-400">–</span>
              <span className="text-stone-700 dark:text-stone-300">
                <span className="font-semibold text-stone-500 dark:text-stone-400">AI</span>
                <span className="ml-1.5 text-lg font-bold tabular-nums">{scores.ai}</span>
              </span>
            </div>
            <select
              value={aiDifficulty}
              onChange={(e) => setAIDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
              className="text-sm rounded-xl border border-stone-200 dark:border-stone-600 bg-stone-50 dark:bg-stone-800 px-3 py-1.5 text-stone-700 dark:text-stone-300 focus:ring-2 focus:ring-amber-400/50 focus:outline-none"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div className="flex justify-center overflow-x-auto -mx-4 px-4 py-1">
            <Board
              board={board}
              onCellClick={(row, col) => setEditingCell({ row, col })}
            />
          </div>

          {humanRack.length > 0 && (
            <div className="rounded-2xl bg-white/80 dark:bg-stone-800/60 px-4 py-3 shadow-card dark:shadow-card-dark border border-stone-200/60 dark:border-stone-700/60">
              <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-2">Your letters</p>
              <Rack letters={humanRack} />
            </div>
          )}

          {lastAIMove && !lastAIMove.passed && (
            <div className="rounded-2xl bg-amber-50/90 dark:bg-amber-900/20 px-4 py-3 border border-amber-200/80 dark:border-amber-800/50">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                AI played <span className="font-bold">{lastAIMove.word}</span> for {lastAIMove.score} pts
              </p>
            </div>
          )}

          {editingCell && (
            <>
              <div
                className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-40 transition-opacity"
                aria-hidden
                onClick={() => setEditingCell(null)}
              />
              <LetterPicker
                onSelect={(letter) => {
                  setBoardCell(editingCell.row, editingCell.col, letter);
                  setEditingCell(null);
                }}
                onClose={() => setEditingCell(null)}
              />
            </>
          )}

          <details className="group rounded-2xl bg-stone-100/80 dark:bg-stone-800/40 border border-stone-200/60 dark:border-stone-700/60 overflow-hidden">
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 list-none select-none">
              Spoiler: AI rack
            </summary>
            <div className="px-4 pb-3 pt-0">
              <Rack letters={aiRack} label="AI rack" />
            </div>
          </details>

          <details className="group rounded-2xl bg-stone-100/80 dark:bg-stone-800/40 border border-stone-200/60 dark:border-stone-700/60 overflow-hidden">
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 list-none select-none">
              Spoiler: Recognized board (for debugging invalid moves)
            </summary>
            <div className="px-4 pb-3 pt-0">
              {debugRecognizedGrid ? (
                <div className="font-mono text-xs overflow-x-auto">
                  <p className="text-stone-500 dark:text-stone-400 mb-1">
                    Last capture that failed validation — what the app saw:
                  </p>
                  <pre className="bg-stone-200/50 dark:bg-stone-900/50 rounded-lg p-2 inline-block">
                    {debugRecognizedGrid.map((row) =>
                      row.map((c) => (c ?? '·')).join(' ')
                    ).join('\n')}
                  </pre>
                </div>
              ) : (
                <p className="text-stone-500 dark:text-stone-400 text-sm">
                  No failed capture yet. When a move is rejected as invalid, the recognized board will appear here.
                </p>
              )}
            </div>
          </details>

          <div className="space-y-4">
            <GameControls onError={showToast} />
            <ChatbotPanel
              enabled={chatEnabled}
              setEnabled={setChatEnabled}
              messages={chatMessages}
              loading={chatLoading}
              onSend={sendChat}
              onClear={() => setChatMessages([])}
              voiceAutoSendEnabled={voiceAutoSendEnabled}
              setVoiceAutoSendEnabled={setVoiceAutoSendEnabled}
              geminiVoiceEnabled={geminiVoiceEnabled}
              setGeminiVoiceEnabled={(v) => {
                setGeminiVoiceEnabled(v);
                // Ensure speech output works even when user only uses chat toggles.
                // This is a user gesture, so it unlocks async speech synthesis on mobile.
                unlockSpeech();
              }}
              geminiVoiceSupported={geminiVoiceSupported}
              geminiVoiceStatus={geminiVoiceStatus}
            />
          </div>

          {gameOver && (
            <div className="text-center py-6 px-4 rounded-2xl bg-white/90 dark:bg-stone-800/80 shadow-card dark:shadow-card-dark border border-stone-200/60 dark:border-stone-700/60">
              <p className="font-display text-2xl font-bold text-stone-800 dark:text-stone-100">
                {scores.human > scores.ai
                  ? 'You win!'
                  : scores.ai > scores.human
                    ? 'AI wins!'
                    : "It's a tie!"}
              </p>
              <button
                type="button"
                onClick={() => initGame(trie)}
                className="mt-5 py-3 px-8 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white rounded-xl font-semibold min-h-[48px] touch-manipulation shadow-md hover:shadow-lg transition-shadow"
              >
                New game
              </button>
            </div>
          )}

          {/* Camera section */}
          <div className="rounded-2xl bg-white/80 dark:bg-stone-800/60 p-4 mt-6 shadow-card dark:shadow-card-dark border border-stone-200/60 dark:border-stone-700/60">
            <div className="flex flex-wrap gap-5 py-2 mb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors">
                <input
                  type="checkbox"
                  checked={validateRack}
                  onChange={(e) => setValidateRack(e.target.checked)}
                  className="rounded border-stone-300 text-amber-600 focus:ring-amber-400"
                />
                <span>Validate rack</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors" title="Invalid words or tiles not in rack cause you to lose your turn">
                <input
                  type="checkbox"
                  checked={loseTurnOnInvalidMove}
                  onChange={(e) => setLoseTurnOnInvalidMove(e.target.checked)}
                  className="rounded border-stone-300 text-amber-600 focus:ring-amber-400"
                />
                <span>Lose turn on invalid move</span>
              </label>
            </div>
            {!stream ? (
              <div className="space-y-4">
                <p className="text-stone-600 dark:text-stone-400 text-center text-sm leading-relaxed">
                  {_currentPlayer === 'human' && !gameOver
                    ? "Your turn. Capture your rack first if needed, then make your move on the board and capture."
                    : "Point at the board or upload a photo. Good lighting, top-down view."}
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.vibrate) navigator.vibrate(50);
                      startCamera();
                    }}
                    disabled={loading}
                    className="w-full py-4 px-6 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl font-semibold min-h-[56px] touch-manipulation shadow-md hover:shadow-lg transition-all"
                  >
                    {loading ? 'Starting camera...' : 'Start camera'}
                  </button>
                  <label className="w-full py-4 px-6 bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 text-stone-800 dark:text-stone-200 rounded-xl font-medium min-h-[56px] touch-manipulation flex items-center justify-center cursor-pointer border border-stone-300/50 dark:border-stone-600/50 transition-colors">
                    Upload board image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          e.target.value = '';
                          handleBoardImage(file);
                        }
                      }}
                    />
                  </label>
                  <label className="w-full py-3 px-6 bg-stone-100 dark:bg-stone-700/80 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 rounded-xl font-medium min-h-[48px] touch-manipulation flex items-center justify-center cursor-pointer border border-stone-300/50 dark:border-stone-600/50 transition-colors">
                    Upload rack image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          e.target.value = '';
                          handleRackImage(file);
                        }
                      }}
                    />
                  </label>
                </div>
                {error && (
                  <p className="text-red-600 dark:text-red-400 text-center text-sm">{error}</p>
                )}
      </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <VoiceCaptureTrigger
                    active={_currentPlayer === 'human' && !gameOver}
                    onCapture={() => {
                      unlockSpeech();
                      if (!recognizingRef.current) cameraRef.current?.capture();
                    }}
                    onRecapture={() => {
                      unlockSpeech();
                      const didUndo = undoLastTurn();
                      if (didUndo && !recognizingRef.current) cameraRef.current?.capture();
                      else if (!didUndo) showToast('Nothing to recapture');
                    }}
                    onFinalTranscript={(t) => {
                      // If AI Chat is enabled, we can optionally treat final speech as chat input.
                      maybeAutoSendVoiceToChat(t);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      unlockSpeech();
                      if (navigator.vibrate) navigator.vibrate(30);
                      if (!recognizing) cameraRef.current?.capture();
                    }}
                    disabled={recognizing}
                    className="flex-1 py-3 px-4 rounded-xl font-semibold touch-manipulation bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white min-h-[48px] shadow-md hover:shadow-lg transition-all"
                  >
                    Capture board
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      unlockSpeech();
                      if (navigator.vibrate) navigator.vibrate(30);
                      const didUndo = undoLastTurn();
                      if (didUndo && !recognizing) {
                        cameraRef.current?.capture();
                      } else if (!didUndo) {
                        showToast('Nothing to recapture');
                      }
                    }}
                    disabled={recognizing || !canRecapture}
                    title={!canRecapture ? 'No previous turn to redo' : 'Undo last move and capture again'}
                    className="flex-1 py-3 px-4 rounded-xl font-semibold touch-manipulation bg-stone-500 hover:bg-stone-600 disabled:opacity-50 disabled:pointer-events-none text-white min-h-[48px] shadow-md hover:shadow-lg transition-all"
                  >
                    Recapture
                  </button>
                </div>
                <CameraView
                  ref={cameraRef}
                  stream={stream}
                  onCapture={handleBoardImage}
                />
                <div className="flex gap-2">
                  <label className="flex-1 py-3 px-4 bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 dark:hover:bg-stone-600 rounded-xl font-medium text-center cursor-pointer touch-manipulation border border-stone-300/50 dark:border-stone-600/50 transition-colors">
                    Upload board
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          unlockSpeech();
                          e.target.value = '';
                          handleBoardImage(file);
                        }
                      }}
                    />
                  </label>
                  <label className="flex-1 py-3 px-4 bg-stone-100 dark:bg-stone-700/80 hover:bg-stone-200 dark:hover:bg-stone-600 rounded-xl font-medium text-center cursor-pointer touch-manipulation border border-stone-300/50 dark:border-stone-600/50 transition-colors">
                    Upload rack
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={recognizing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          unlockSpeech();
                          e.target.value = '';
                          handleRackImage(file);
                        }
                      }}
                    />
                  </label>
                </div>
                {_currentPlayer === 'human' && !gameOver && !recognizing && (
                  <p className="text-stone-500 dark:text-stone-400 text-center text-sm leading-relaxed">
                    Make your move, then say &quot;your turn&quot;, &quot;done&quot;, &quot;finish&quot;, &quot;go&quot;, or &quot;recapture&quot;—or tap Capture board.
                  </p>
                )}
              </>
            )}
          </div>

          {recognizing && (
            <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/50 backdrop-blur-md transition-opacity">
              <div className="flex flex-col items-center gap-5 rounded-2xl bg-stone-800/95 px-10 py-8 shadow-2xl border border-stone-700/50">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-amber-400/30 border-t-amber-400" />
                <div className="text-center">
                  <p className="text-lg font-semibold text-white">Recognizing...</p>
                  <p className="text-sm text-stone-400 mt-0.5">This may take a few seconds</p>
                </div>
              </div>
            </div>
          )}

          {blankLetterPrompt && (
            <BlankLetterModal
              pending={blankLetterPrompt.pending}
              onCancel={() => setBlankLetterPrompt(null)}
              onConfirm={(lettersByKey) => {
                const gridSnapshot = blankLetterPrompt.grid;
                setBlankLetterPrompt(null);
                const result = applyHumanMoveFromBoardImage(gridSnapshot, lettersByKey);
                boardRecLog('applyHumanMoveFromBoardImage (blank letters resolved)', {
                  success: result.success,
                  lostTurn: 'lostTurn' in result ? result.lostTurn : undefined,
                  message: 'message' in result ? result.message : undefined,
                });
                if (!result.success && 'needsBlankLetters' in result && result.needsBlankLetters) {
                  setBlankLetterPrompt({ grid: result.grid, pending: result.pendingBlanks });
                  setDebugRecognizedGrid(gridSnapshot);
                  return;
                }
                if (!result.success) {
                  setDebugRecognizedGrid(gridSnapshot);
                  showToast(
                    'message' in result && result.message ? result.message : 'Invalid move'
                  );
                  return;
                }
                if (result.lostTurn) {
                  setDebugRecognizedGrid(gridSnapshot);
                  showToast(
                    'message' in result && result.message
                      ? result.message
                      : 'Invalid move—you lost your turn'
                  );
                  return;
                }
                setDebugRecognizedGrid(null);
              }}
            />
          )}

          {toast && (
            <div
              role="alert"
              className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-xl px-4 py-3 bg-amber-600 text-white rounded-2xl shadow-xl flex items-center justify-between gap-3"
            >
              <p className="text-sm flex-1">{toast}</p>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="shrink-0 px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium touch-manipulation transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
