import { useEffect, useState, useRef, useCallback } from 'react';
import { Board } from './components/Board';
import { LetterPicker } from './components/LetterPicker';
import { Rack } from './components/Rack';
import { GameControls } from './components/GameControls';
import { CameraView, type CameraViewRef } from './components/CameraView';
import { VoiceCaptureTrigger } from './components/VoiceCaptureTrigger';
import { useGameStore } from './store/gameStore';
import { useCamera } from './hooks/useCamera';
import { speak } from './hooks/useSpeechSynthesis';
import { loadDictionary } from './game/loadDictionary';
import { recognizeBoard } from './cv/BoardRecognizer';
import { recognizeRackFromImage } from './cv/scrabblecamApi';
import { prepareImageForRecognition } from './cv/imageUtils';

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
    setBoardCell,
    aiDifficulty,
    setAIDifficulty,
  } = useGameStore();
  const { stream, error, loading, startCamera, stopCamera } = useCamera();
  const [recognizing, setRecognizing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [useGeminiFix, setUseGeminiFix] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const setBoardFromRecognition = useGameStore((s) => s.setBoardFromRecognition);
  const setHumanRack = useGameStore((s) => s.setHumanRack);
  const applyHumanMoveFromBoardImage = useGameStore((s) => s.applyHumanMoveFromBoardImage);
  const lastAIMoveRef = useRef<unknown>(null);
  const cameraRef = useRef<CameraViewRef>(null);
  const recognizingRef = useRef(recognizing);
  recognizingRef.current = recognizing;

  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 5000);
  }, []);

  const handleBoardImage = useCallback(
    async (file: Blob) => {
      setRecognizing(true);
      setToast(null);
      // Yield to browser so video can render next frame before we block
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      try {
        const prepared = await prepareImageForRecognition(file);
        const grid = await recognizeBoard(prepared, { useGeminiFix });
        const isHumanTurn = useGameStore.getState().currentPlayer === 'human';
        if (isHumanTurn) {
          const result = applyHumanMoveFromBoardImage(grid);
          if (!result.success) {
            showToast(result.message ?? 'Recognition failed');
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
    [applyHumanMoveFromBoardImage, setBoardFromRecognition, useGeminiFix, showToast]
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
      if (lastAIMove.passed) {
        speak('I pass. Your turn.');
      } else {
        const letters = lastAIMove.word.split('').join(' ');
        speak(`I play ${letters} for ${lastAIMove.score} points. Place my tiles on the board, then make your move and capture. Your turn.`);
      }
    }
  }, [lastAIMove]);

  useEffect(() => {
    if (_currentPlayer === 'human' && !gameOver && humanTurnRef.current === false) {
      humanTurnRef.current = true;
      if (humanRack.length > 0) {
        const letters = humanRack.map((c) => (c === ' ' ? 'blank' : c)).join(', ');
        speak(`Your letters are ${letters}.`);
      }
    } else if (_currentPlayer !== 'human') {
      humanTurnRef.current = false;
    }
  }, [_currentPlayer, gameOver, humanRack]);

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

          <div className="space-y-4">
            <GameControls onError={showToast} />
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
              <label className="flex items-center gap-2 text-sm cursor-pointer text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors">
                <input
                  type="checkbox"
                  checked={useGeminiFix}
                  onChange={(e) => setUseGeminiFix(e.target.checked)}
                  className="rounded border-stone-300 text-amber-600 focus:ring-amber-400"
                />
                <span>AI fix (Gemini)</span>
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
                      if (!recognizingRef.current) cameraRef.current?.capture();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.vibrate) navigator.vibrate(30);
                      if (!recognizing) cameraRef.current?.capture();
                    }}
                    disabled={recognizing}
                    className="flex-1 py-3 px-4 rounded-xl font-semibold touch-manipulation bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white min-h-[48px] shadow-md hover:shadow-lg transition-all"
                  >
                    Capture board
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
                          e.target.value = '';
                          handleRackImage(file);
                        }
                      }}
                    />
                  </label>
                </div>
                {_currentPlayer === 'human' && !gameOver && !recognizing && (
                  <p className="text-stone-500 dark:text-stone-400 text-center text-sm leading-relaxed">
                    Make your move, then say &quot;your turn&quot;, &quot;capture&quot;, &quot;done&quot;, &quot;finish&quot;, &quot;go&quot;, etc.—or tap Capture board.
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
